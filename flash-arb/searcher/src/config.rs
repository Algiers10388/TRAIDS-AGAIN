use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainConfig {
    pub chain_id: u64,
    pub chain_name: String,
    pub rpc_http: String,
    pub rpc_ws: String,
    pub relay_endpoint: String,
    pub is_l2: bool,
    pub sequencer_priority_bidding: bool,
    pub tip_share_percent: u64,
    pub aave_v3_pool: String,
    pub aave_v3_addresses_provider: String,
    pub aave_flash_fee_bps: u64,
    pub flash_arb_contract: String,
    pub dexes: HashMap<String, DexConfig>,
    pub tokens: HashMap<String, String>,
    pub risk: RiskConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexConfig {
    pub router: Option<String>,
    pub quoter: Option<String>,
    pub factory: Option<String>,
    pub two_pool: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub min_net_profit_usd: f64,
    pub max_gas_per_tx: u64,
    pub daily_revert_loss_cap_usd: f64,
    pub consecutive_failure_limit: u32,
    pub dry_run: bool,
    pub simulation_engine: String,
    pub excluded_tokens: Vec<String>,
}

impl ChainConfig {
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> eyre::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: ChainConfig = toml::from_str(&content)?;
        Ok(config)
    }
}
