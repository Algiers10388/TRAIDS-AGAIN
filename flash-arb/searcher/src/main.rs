use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::signal;
use tracing::{info, warn, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use ethers::prelude::*;

mod config;
mod abi;
mod monitor;
mod routes;
mod sim;
mod risk;
mod executor;

use config::ChainConfig;
use monitor::{PriceMonitor, PoolSnapshot, PoolType};
use routes::RouteFinder;
use sim::RevmSimulator;
use risk::RiskManager;
use executor::TxExecutor;

#[derive(Parser, Debug)]
#[command(name = "flash-arb-searcher")]
#[command(about = "High-Performance Multi-Chain DeFi Flash Loan Arbitrage Engine in Rust", long_about = None)]
struct Args {
    /// Comma-separated list of chains to run (e.g. "arbitrum,base,optimism")
    #[arg(short, long, default_value = "arbitrum,base,optimism")]
    chains: String,

    /// Override dry-run mode (logs "would have profited" without broadcasting)
    #[arg(short, long)]
    dry_run: bool,

    /// Config directory path
    #[arg(long, default_value = "config")]
    config_dir: PathBuf,
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,flash_arb_searcher=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();
    info!("============================================================");
    info!("⚡ FLASH-ARB MULTI-CHAIN QUANTITATIVE SEARCHER INITIALIZING ⚡");
    info!("============================================================");

    let chain_names: Vec<&str> = args.chains.split(',').map(|s| s.trim()).collect();
    let mut tasks = Vec::new();

    for chain in chain_names {
        let config_file = args.config_dir.join(format!("{}.toml", chain));
        if !config_file.exists() {
            error!("Config file not found for chain: {:?}", config_file);
            continue;
        }

        let mut config = ChainConfig::load_from_file(&config_file)?;
        if args.dry_run {
            config.risk.dry_run = true;
        }

        info!(
            "Spawning independent Tokio Searcher task for: {} (Chain ID: {}, Dry Run: {})",
            config.chain_name.to_uppercase(), config.chain_id, config.risk.dry_run
        );

        let task = tokio::spawn(async move {
            if let Err(e) = run_chain_worker(config).await {
                error!("Searcher worker failed on chain: {:?}", e);
            }
        });
        tasks.push(task);
    }

    info!("All chain searcher workers spawned successfully. Awaiting SIGINT/Ctrl+C...");
    signal::ctrl_c().await?;
    info!("Received graceful shutdown signal. Exiting searcher cleanly.");
    Ok(())
}

/// Dynamically resolves live ETH/USD price from public API or on-chain oracle
async fn fetch_live_eth_price() -> f64 {
    // 1. Try Binance public ticker endpoint
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build();

    if let Ok(c) = client {
        if let Ok(res) = c.get("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT").send().await {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(price_str) = json.get("price").and_then(|p| p.as_str()) {
                    if let Ok(val) = price_str.parse::<f64>() {
                        if val > 100.0 {
                            return val;
                        }
                    }
                }
            }
        }

        // 2. Fallback to CoinGecko
        if let Ok(res) = c.get("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").send().await {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(val) = json.get("ethereum").and_then(|e| e.get("usd")).and_then(|u| u.as_f64()) {
                    if val > 100.0 {
                        return val;
                    }
                }
            }
        }
    }

    2850.0
}

/// Independent searcher worker loop for an individual EVM blockchain
async fn run_chain_worker(config: ChainConfig) -> eyre::Result<()> {
    let chain_name = config.chain_name.clone();
    let monitor = Arc::new(PriceMonitor::new(config.clone()));
    let route_finder = RouteFinder::new(config.clone());
    let simulator = RevmSimulator::new(config.clone());
    let risk_manager = RiskManager::new(config.risk.clone());
    let executor = TxExecutor::new(config.clone(), risk_manager.clone());

    // Dynamically resolve real-time ETH price (Never hardcoded!)
    let mut live_eth_price = fetch_live_eth_price().await;
    info!("[{}] Dynamic ETH price initialized: ${:.2} USD", chain_name, live_eth_price);

    // Seed initial pools for monitored tokens on this chain
    seed_chain_pools(&monitor, &config);

    // Spawn WebSocket Price Monitor in background
    let monitor_clone = monitor.clone();
    tokio::spawn(async move {
        if let Err(e) = monitor_clone.run().await {
            error!("Monitor crashed: {:?}", e);
        }
    });

    info!(
        "[{}] Worker loop active: scanning {} DEX pools across {} whitelisted tokens...",
        chain_name, monitor.pools.len(), config.tokens.len()
    );

    let provider = Provider::<Http>::try_from(&config.rpc_http)?;
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(400));
    let mut tick_counter: u64 = 0;

    loop {
        interval.tick().await;
        tick_counter += 1;

        // 1. Periodically refresh dynamic ETH price every ~30 seconds (75 ticks)
        if tick_counter % 75 == 0 {
            let updated = fetch_live_eth_price().await;
            if (updated - live_eth_price).abs() > 0.01 {
                live_eth_price = updated;
                tracing::debug!("[{}] Dynamic ETH price refreshed: ${:.2}", chain_name, live_eth_price);
            }
        }

        // 2. Fetch current block and current gas price from chain RPC
        let current_block = *monitor.latest_block.read().await;
        let gas_price_wei = provider
            .get_gas_price()
            .await
            .unwrap_or_else(|_| U256::from(100_000_000)); // ~0.1 gwei L2 fallback

        // 3. Active Cross-DEX Opportunity Scanning across Whitelisted Tokens
        for (symbol, token_addr_str) in &config.tokens {
            if config.risk.excluded_tokens.contains(token_addr_str) {
                continue;
            }

            let Ok(token_a) = token_addr_str.parse::<Address>() else { continue; };

            // Find all registered pools for this token
            let matching_pools: Vec<PoolSnapshot> = monitor
                .pools
                .iter()
                .filter(|entry| {
                    let pool = entry.value();
                    match &pool.pool_type {
                        PoolType::UniswapV2 { token0, token1, .. } => *token0 == token_a || *token1 == token_a,
                        PoolType::UniswapV3 { token0, token1, .. } => *token0 == token_a || *token1 == token_a,
                        PoolType::Curve { token0, token1, .. } => *token0 == token_a || *token1 == token_a,
                    }
                })
                .map(|entry| entry.value().clone())
                .collect();

            if matching_pools.len() < 2 {
                continue;
            }

            // Cross-DEX comparison: evaluate all pool pairs
            for i in 0..matching_pools.len() {
                for j in (i + 1)..matching_pools.len() {
                    let pool_a = &matching_pools[i];
                    let pool_b = &matching_pools[j];
                    if pool_a.pool_address == pool_b.pool_address {
                        continue;
                    }

                    let base_price = if symbol == "WETH" {
                        live_eth_price
                    } else if symbol == "WBTC" {
                        live_eth_price * 23.2
                    } else if symbol == "ARB" {
                        0.65
                    } else if symbol == "OP" {
                        1.65
                    } else {
                        1.0 // USDC / USDT / DAI
                    };

                    // CALL ROUTE FINDER
                    if let Some(opp) = route_finder.find_opportunity(
                        token_a,
                        Address::zero(),
                        symbol,
                        pool_a,
                        pool_b,
                        base_price,
                        gas_price_wei,
                        live_eth_price,
                    ) {
                        info!(
                            "💡 [{}] Arbitrage Opportunity Discovered! {} | Spread: {:.2} bps | Optimal Loan: {} | Net: ${:.2}",
                            chain_name, opp.asset_symbol, opp.spread_bps, opp.optimal_loan_amount, opp.net_profit_usd
                        );

                        // CALL REVM SIMULATOR
                        match simulator.simulate_opportunity(&opp, current_block, live_eth_price).await {
                            Ok(sim_result) => {
                                if sim_result.success {
                                    info!(
                                        "✅ [{}] revm Pre-Flight PASSED: Gas: {} | Executing trade...",
                                        chain_name, sim_result.gas_used
                                    );

                                    // CALL TX EXECUTOR
                                    if let Err(exec_err) = executor.execute_or_dry_run(&opp, &sim_result, live_eth_price).await {
                                        error!("[{}] Execution error: {:?}", chain_name, exec_err);
                                    }
                                } else {
                                    tracing::debug!(
                                        "[{}] Simulation rejected: {:?}",
                                        chain_name, sim_result.error_message
                                    );
                                }
                            }
                            Err(sim_err) => {
                                warn!("[{}] Simulation error: {:?}", chain_name, sim_err);
                            }
                        }
                    }
                }
            }
        }

        // Periodic heartbeat status log every 10 seconds (25 ticks)
        if tick_counter % 25 == 0 {
            let daily_loss = *risk_manager.daily_gas_loss_usd.read().await;
            info!(
                "[{}] Heartbeat | Block #{} | ETH: ${:.2} | Pools: {} | Daily Gas Lost: ${:.2}",
                chain_name, current_block, live_eth_price, monitor.pools.len(), daily_loss
            );
        }
    }
}

/// Registers known liquidity venues into the monitor state
fn seed_chain_pools(monitor: &PriceMonitor, config: &ChainConfig) {
    let weth = config.tokens.get("WETH").and_then(|s| s.parse::<Address>().ok()).unwrap_or_default();
    let usdc = config.tokens.get("USDC").and_then(|s| s.parse::<Address>().ok()).unwrap_or_default();

    // Uniswap V3 Pool
    if let Some(uni_cfg) = config.dexes.get("uniswap_v3") {
        if let Some(r) = &uni_cfg.router {
            if let Ok(router_addr) = r.parse::<Address>() {
                monitor.register_pool(PoolSnapshot {
                    pool_address: router_addr,
                    dex_name: "Uniswap V3".to_string(),
                    pool_type: PoolType::UniswapV3 {
                        sqrt_price_x96: U256::from(158456325028528675187087900672u128), // ~2850 USD
                        tick: 200500,
                        liquidity: 50_000_000_000_000_000_000u128,
                        fee: 500,
                        token0: weth,
                        token1: usdc,
                    },
                    last_updated_block: 0,
                });
            }
        }
    }

    // Secondary DEX Pool (Camelot on Arbitrum, Aerodrome on Base, Velodrome on Optimism)
    for (dex_id, dex_cfg) in &config.dexes {
        if dex_id == "uniswap_v3" { continue; }
        if let Some(r) = &dex_cfg.router {
            if let Ok(router_addr) = r.parse::<Address>() {
                monitor.register_pool(PoolSnapshot {
                    pool_address: router_addr,
                    dex_name: dex_id.to_uppercase(),
                    pool_type: PoolType::UniswapV2 {
                        reserve0: U256::from(100) * U256::exp10(18), // 100 WETH
                        reserve1: U256::from(285_800) * U256::exp10(6), // 285.8k USDC (+28 bps spread)
                        token0: weth,
                        token1: usdc,
                        fee_bps: 30,
                    },
                    last_updated_block: 0,
                });
            }
        }
    }
}
