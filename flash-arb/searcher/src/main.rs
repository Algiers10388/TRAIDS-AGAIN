mod abi;
mod config;
mod executor;
mod monitor;
mod risk;
mod routes;
mod sim;

use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use ethers::prelude::*;
use tracing::{error, info, warn};

use config::ChainConfig;
use executor::Executor;
use monitor::{discover_all, is_stable, EthOracle, PairMarket};
use risk::RiskManager;

#[derive(Parser, Debug)]
#[command(name = "flash-arb-searcher", about = "Aave V3 flash-loan arbitrage searcher (real on-chain quotes)")]
struct Args {
    /// Comma separated chain config names (files in --config-dir), e.g. arbitrum,base,optimism
    #[arg(long, default_value = "arbitrum,base,optimism")]
    chains: String,
    #[arg(long, default_value = "config")]
    config_dir: PathBuf,
    /// Actually send transactions. Without this flag the searcher only scans and simulates.
    #[arg(long, default_value_t = false)]
    live: bool,
    /// Accepted for compatibility; scan-only is already the default.
    #[arg(long, default_value_t = false)]
    dry_run: bool,
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();

    let mut handles = Vec::new();
    for name in args.chains.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let path = args.config_dir.join(format!("{}.toml", name));
        let cfg = ChainConfig::load_from_file(&path).map_err(|e| eyre::eyre!("{}: {}", path.display(), e))?;
        let live = args.live && !args.dry_run && !cfg.risk.dry_run;
        if args.live && !live {
            warn!("[{}] --live requested but risk.dry_run = true in the config: staying in scan-only mode", cfg.chain_name);
        }
        let chain = cfg.chain_name.clone();
        handles.push(tokio::spawn(async move {
            if let Err(e) = run_chain(cfg, live).await {
                error!("[{}] worker stopped: {:#}", chain, e);
            }
        }));
    }
    if handles.is_empty() {
        eyre::bail!("no chains selected");
    }
    tokio::select! {
        _ = tokio::signal::ctrl_c() => info!("shutting down"),
        _ = futures_join(handles) => warn!("all chain workers have stopped"),
    }
    Ok(())
}

async fn futures_join(handles: Vec<tokio::task::JoinHandle<()>>) {
    for h in handles {
        let _ = h.await;
    }
}

async fn run_chain(cfg: ChainConfig, live: bool) -> eyre::Result<()> {
    let provider = Provider::<Http>::try_from(cfg.rpc_http.as_str())?;
    let remote_chain = provider.get_chainid().await?.as_u64();
    if remote_chain != cfg.chain_id {
        eyre::bail!("RPC reports chain id {} but config says {}", remote_chain, cfg.chain_id);
    }
    let contract = cfg.flash_arb_address()?;
    let signer = cfg.signer_address()?;
    let recipient = cfg.profit_recipient()?;
    let risk = RiskManager::new(cfg.risk.clone());

    let executor = if live {
        Some(Executor::new(&cfg, &provider).await?)
    } else {
        if !contract.is_zero() {
            // Read-only sanity checks so a mis-configured contract is caught even when scanning.
            let owner = abi::contract_owner(&provider, contract).await?;
            if owner != signer {
                eyre::bail!("FlashArb owner is {:?} but signer.gas_wallet_address is {:?}", owner, signer);
            }
        }
        info!("[{}] SCAN-ONLY mode: opportunities are quoted and simulated, nothing is sent", cfg.chain_name);
        None
    };

    let oracle = EthOracle::new(&cfg, &provider)
        .await
        .ok_or_else(|| eyre::eyre!("cannot price ETH on-chain (need a WETH/stable pool); refusing to run blind"))?;
    let mut markets: Vec<PairMarket> = discover_all(&cfg, &provider).await;
    let mut eth_usd = oracle.eth_usd(&provider).await.unwrap_or(0.0);
    let mut last_block = 0u64;
    let mut ticks = 0u64;
    let mut ticker = tokio::time::interval(Duration::from_millis(cfg.poll_interval_ms.max(200)));

    loop {
        ticker.tick().await;
        let head = match provider.get_block_number().await {
            Ok(b) => b.as_u64(),
            Err(e) => {
                warn!("[{}] get_block_number: {}", cfg.chain_name, e);
                continue;
            }
        };
        if head == last_block {
            continue;
        }
        last_block = head;
        ticks += 1;

        if ticks % 1000 == 0 {
            markets = discover_all(&cfg, &provider).await;
        }
        if ticks % 20 == 1 {
            match oracle.eth_usd(&provider).await {
                Some(p) => eth_usd = p,
                None => warn!("[{}] ETH/USD quote failed; keeping last value", cfg.chain_name),
            }
        }
        if eth_usd <= 0.0 {
            continue;
        }
        if risk.is_tripped() {
            warn!("[{}] circuit breaker tripped; not scanning. Restart after investigating.", cfg.chain_name);
            tokio::time::sleep(Duration::from_secs(30)).await;
            continue;
        }

        let gas_price = match provider.get_gas_price().await {
            Ok(g) => g,
            Err(e) => {
                warn!("[{}] get_gas_price: {}", cfg.chain_name, e);
                continue;
            }
        };

        for m in &markets {
            if risk.is_excluded(m.base) || risk.is_excluded(m.quote) {
                continue;
            }
            let base_usd = if is_stable(&m.base_sym) { 1.0 } else { eth_usd };
            let max_amount = U256::from((cfg.risk.max_loan_usd / base_usd * 10f64.powi(m.base_dec as i32)) as u128);
            let Some(opp) = routes::find_best(&cfg, &provider, m, max_amount).await else { continue };

            let gross_usd = opp.gross_profit_f64() * base_usd;
            if gross_usd <= cfg.risk.min_net_profit_usd {
                continue; // gas can only make it worse; skip the simulation
            }
            let min_profit = (opp.gross_profit * U256::from(80u64) / U256::from(100u64)).max(U256::one());
            let calldata = abi::encode_execute_flash_arb(opp.base, opp.amount_in, min_profit, &opp.leg1(), &opp.leg2(), recipient);

            let gas = if contract.is_zero() {
                info!("[{}] no flash_arb_contract configured: skipping on-chain simulation", cfg.chain_name);
                400_000
            } else {
                match sim::simulate(&provider, signer, contract, calldata.clone()).await {
                    Ok(g) => g,
                    Err(e) => {
                        info!("[{}] block {} {} {} -> {}: simulation rejected: {}", cfg.chain_name, head, opp.pair_label, opp.venue_a.label(), opp.venue_b.label(), e);
                        continue;
                    }
                }
            };
            let gas_cost_usd = gas as f64 * (gas_price.as_u128() as f64 / 1e18) * eth_usd;
            let net_usd = gross_usd - gas_cost_usd - cfg.risk.extra_cost_usd;
            info!(
                "[{}] block {} {} sell {} / buy {}: loan {:.4} {} gross ${:.2} gas ${:.2} net ${:.2}",
                cfg.chain_name, head, opp.pair_label, opp.venue_a.label(), opp.venue_b.label(),
                opp.amount_in.as_u128() as f64 / 10f64.powi(m.base_dec as i32), m.base_sym, gross_usd, gas_cost_usd, net_usd
            );
            if net_usd < cfg.risk.min_net_profit_usd {
                continue;
            }
            let Some(exec) = &executor else {
                info!("[{}] scan-only: would execute (net ${:.2})", cfg.chain_name, net_usd);
                continue;
            };
            if let Err(why) = risk.can_execute(&[opp.base, opp.quote], gas) {
                warn!("[{}] risk check blocked trade: {}", cfg.chain_name, why);
                continue;
            }
            match exec.send(&provider, contract, calldata, gas, net_usd, eth_usd).await {
                Ok(o) if o.success => {
                    risk.record_success();
                    info!("[{}] SUCCESS {:?} gas {}", cfg.chain_name, o.hash, o.gas_used);
                }
                Ok(o) => {
                    let lost = o.gas_used.as_u128() as f64 * (o.effective_gas_price.as_u128() as f64 / 1e18) * eth_usd;
                    risk.record_revert(lost);
                    error!("[{}] REVERTED {:?}", cfg.chain_name, o.hash);
                }
                Err(e) => error!("[{}] send failed: {:#}", cfg.chain_name, e),
            }
            break; // state changed; rescan on next block
        }
    }
}
