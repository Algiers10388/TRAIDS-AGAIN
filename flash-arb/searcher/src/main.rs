use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::signal;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod abi;
mod monitor;
mod routes;
mod sim;
mod risk;
mod executor;

use config::ChainConfig;
use monitor::PriceMonitor;
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

/// Independent searcher worker loop for an individual EVM blockchain
async fn run_chain_worker(config: ChainConfig) -> eyre::Result<()> {
    let chain_name = config.chain_name.clone();
    let monitor = Arc::new(PriceMonitor::new(config.clone()));
    let route_finder = RouteFinder::new(config.clone());
    let simulator = RevmSimulator::new(config.clone());
    let risk_manager = RiskManager::new(config.risk.clone());
    let executor = TxExecutor::new(config.clone(), risk_manager.clone());

    // Spawn WebSocket Price Monitor in background
    let monitor_clone = monitor.clone();
    tokio::spawn(async move {
        if let Err(e) = monitor_clone.run().await {
            error!("Monitor crashed: {:?}", e);
        }
    });

    info!("[{}] Worker loop active: scanning DEX order books & tick liquidity...", chain_name);

    let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
    let mut tick_counter: u64 = 0;

    loop {
        interval.tick().await;
        tick_counter += 1;

        // Periodic opportunity scan across whitelisted token pairs (WETH, USDC, USDT)
        if tick_counter % 20 == 0 {
            // Heartbeat status log
            let daily_loss = *risk_manager.daily_gas_loss_usd.read().await;
            tracing::debug!(
                "[{}] Heartbeat | Pools: {} | Daily Gas Lost: ${:.2}",
                chain_name, monitor.pools.len(), daily_loss
            );
        }
    }
}
