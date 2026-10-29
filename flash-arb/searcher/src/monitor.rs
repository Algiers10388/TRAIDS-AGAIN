//! Venue discovery and the on-chain USD price oracle.
//!
//! No pool state is cached or approximated: venues are discovered from the DEX factories, and every
//! price is an exact on-chain quote taken at the current block (see routes.rs).

use ethers::prelude::*;
use tracing::{debug, info, warn};

use crate::abi;
use crate::config::{parse_addr, ChainConfig, DexKind};

const V3_FEE_TIERS: [u32; 4] = [100, 500, 3000, 10_000];
const STABLES: [&str; 4] = ["USDC", "USDT", "DAI", "USDbC"];

#[derive(Debug, Clone)]
pub struct Venue {
    pub name: String,
    pub kind: DexKind,
    pub router: Address,
    pub quoter: Option<Address>,
    pub quoter_v2: bool,
    pub factory: Address,
    pub v3_fee: u32,
    pub stable: bool,
}

impl Venue {
    pub fn label(&self) -> String {
        match self.kind {
            DexKind::V3 | DexKind::V3Router02 => format!("{}/{}bps", self.name, self.v3_fee / 100),
            DexKind::Solidly => format!("{}/{}", self.name, if self.stable { "stable" } else { "volatile" }),
            _ => self.name.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PairMarket {
    pub base_sym: String,
    pub quote_sym: String,
    pub base: Address,
    pub quote: Address,
    pub base_dec: u8,
    pub quote_dec: u8,
    pub venues: Vec<Venue>,
}

pub fn is_stable(sym: &str) -> bool {
    STABLES.iter().any(|s| s.eq_ignore_ascii_case(sym))
}

/// Discovers every venue that can trade `base`/`quote`.
pub async fn discover_pair(
    cfg: &ChainConfig,
    provider: &Provider<Http>,
    base_sym: &str,
    quote_sym: &str,
) -> eyre::Result<PairMarket> {
    let base = parse_addr(cfg.tokens.get(base_sym).ok_or_else(|| eyre::eyre!("unknown token {}", base_sym))?)?;
    let quote = parse_addr(cfg.tokens.get(quote_sym).ok_or_else(|| eyre::eyre!("unknown token {}", quote_sym))?)?;
    let base_dec = abi::erc20_decimals(provider, base).await?;
    let quote_dec = abi::erc20_decimals(provider, quote).await?;

    let mut venues = Vec::new();
    for (name, dex) in &cfg.dexes {
        let kind = dex.kind_enum()?;
        let router = match dex.router.as_deref().map(parse_addr) {
            Some(Ok(a)) => a,
            _ => continue,
        };
        let factory = match dex.factory.as_deref().map(parse_addr) {
            Some(Ok(a)) => a,
            _ => Address::zero(),
        };
        match kind {
            DexKind::V2 => {
                if factory.is_zero() {
                    continue;
                }
                match abi::v2_get_pair(provider, factory, base, quote).await {
                    Ok(p) if !p.is_zero() => venues.push(Venue {
                        name: name.clone(), kind, router, quoter: None, quoter_v2: false, factory, v3_fee: 0, stable: false,
                    }),
                    Ok(_) => {}
                    Err(e) => debug!("[{}] {} getPair failed: {}", cfg.chain_name, name, e),
                }
            }
            DexKind::V3 | DexKind::V3Router02 => {
                let quoter = match dex.quoter.as_deref().map(parse_addr) {
                    Some(Ok(a)) => a,
                    _ => continue,
                };
                if factory.is_zero() {
                    continue;
                }
                for fee in V3_FEE_TIERS {
                    match abi::v3_get_pool(provider, factory, base, quote, fee).await {
                        Ok(pool) if !pool.is_zero() => {
                            let liq = abi::v3_liquidity(provider, pool).await.unwrap_or_default();
                            if liq.is_zero() {
                                continue;
                            }
                            venues.push(Venue {
                                name: name.clone(), kind, router, quoter: Some(quoter), quoter_v2: dex.quoter_v2,
                                factory, v3_fee: fee, stable: false,
                            });
                        }
                        Ok(_) => {}
                        Err(e) => debug!("[{}] {} getPool({}) failed: {}", cfg.chain_name, name, fee, e),
                    }
                }
            }
            DexKind::Solidly => {
                if factory.is_zero() {
                    continue;
                }
                for stable in [false, true] {
                    match abi::solidly_get_pool(provider, factory, base, quote, stable).await {
                        Ok(pool) if !pool.is_zero() => venues.push(Venue {
                            name: name.clone(), kind, router, quoter: None, quoter_v2: false, factory, v3_fee: 0, stable,
                        }),
                        Ok(_) => {}
                        Err(e) => debug!("[{}] {} getPool(stable={}) failed: {}", cfg.chain_name, name, stable, e),
                    }
                }
            }
            DexKind::Curve => {
                debug!("[{}] curve venue '{}' is executable on-chain but not scanned by this searcher", cfg.chain_name, name);
            }
        }
    }

    info!(
        "[{}] {}/{}: {} venue(s): {}",
        cfg.chain_name,
        base_sym,
        quote_sym,
        venues.len(),
        venues.iter().map(|v| v.label()).collect::<Vec<_>>().join(", ")
    );
    Ok(PairMarket { base_sym: base_sym.into(), quote_sym: quote_sym.into(), base, quote, base_dec, quote_dec, venues })
}

pub async fn discover_all(cfg: &ChainConfig, provider: &Provider<Http>) -> Vec<PairMarket> {
    let mut out = Vec::new();
    for p in &cfg.pairs {
        if !(is_stable(&p.base) || p.base == "WETH") {
            warn!("[{}] pair {}/{} skipped: base must be WETH or a stablecoin so profit can be priced in USD", cfg.chain_name, p.base, p.quote);
            continue;
        }
        match discover_pair(cfg, provider, &p.base, &p.quote).await {
            Ok(m) if m.venues.len() >= 2 => out.push(m),
            Ok(m) => info!("[{}] {}/{} has {} venue(s); need at least 2", cfg.chain_name, p.base, p.quote, m.venues.len()),
            Err(e) => warn!("[{}] discovery failed for {}/{}: {}", cfg.chain_name, p.base, p.quote, e),
        }
    }
    out
}

/// ETH/USD from on-chain quotes of 1 WETH into a stablecoin (median across venues).
pub struct EthOracle {
    market: PairMarket,
}

impl EthOracle {
    pub async fn new(cfg: &ChainConfig, provider: &Provider<Http>) -> Option<Self> {
        if !cfg.tokens.contains_key("WETH") {
            return None;
        }
        for stable in STABLES {
            if cfg.tokens.contains_key(stable) {
                if let Ok(m) = discover_pair(cfg, provider, "WETH", stable).await {
                    if !m.venues.is_empty() {
                        return Some(Self { market: m });
                    }
                }
            }
        }
        None
    }

    pub async fn eth_usd(&self, provider: &Provider<Http>) -> Option<f64> {
        let one = U256::exp10(self.market.base_dec as usize);
        let mut prices = Vec::new();
        for v in &self.market.venues {
            if let Some(out) = crate::routes::quote(provider, v, self.market.base, self.market.quote, one).await {
                let px = out.as_u128() as f64 / 10f64.powi(self.market.quote_dec as i32);
                if px > 0.0 {
                    prices.push(px);
                }
            }
        }
        if prices.is_empty() {
            return None;
        }
        prices.sort_by(|a, b| a.partial_cmp(b).unwrap());
        Some(prices[prices.len() / 2])
    }
}
