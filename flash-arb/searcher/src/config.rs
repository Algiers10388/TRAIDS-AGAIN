use ethers::types::Address;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

fn default_poll_ms() -> u64 {
    1000
}
fn default_max_loan_usd() -> f64 {
    25_000.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainConfig {
    pub chain_id: u64,
    pub chain_name: String,
    /// HTTP JSON-RPC. Override with env RPC_HTTP_<CHAIN_NAME_UPPERCASE>.
    #[serde(default)]
    pub rpc_http: String,
    /// Optional WebSocket JSON-RPC. Override with env RPC_WS_<CHAIN_NAME_UPPERCASE>.
    /// If empty, new blocks are polled over HTTP.
    #[serde(default)]
    pub rpc_ws: String,
    /// Optional private tx endpoint accepting eth_sendRawTransaction. Empty = use rpc_http.
    #[serde(default)]
    pub relay_endpoint: String,
    pub is_l2: bool,
    /// Only true where the sequencer orders by priority fee (e.g. Base, Optimism).
    /// Arbitrum's sequencer is first-come-first-served, so this must stay false there.
    #[serde(default)]
    pub priority_fee_bidding: bool,
    /// Share (0-90) of expected net profit offered as priority fee when priority_fee_bidding = true.
    #[serde(default)]
    pub tip_share_percent: u64,
    #[serde(default = "default_poll_ms")]
    pub poll_interval_ms: u64,
    pub aave_v3_pool: String,
    pub aave_v3_addresses_provider: String,
    pub aave_flash_fee_bps: u64,
    pub flash_arb_contract: String,
    pub dexes: HashMap<String, DexConfig>,
    pub tokens: HashMap<String, String>,
    #[serde(default)]
    pub pairs: Vec<PairConfig>,
    pub risk: RiskConfig,
    pub beneficiary: BeneficiaryConfig,
    pub signer: SignerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexConfig {
    /// One of: v2 | v3 | v3_router02 | solidly | curve
    pub kind: String,
    pub router: Option<String>,
    pub quoter: Option<String>,
    pub factory: Option<String>,
    pub two_pool: Option<String>,
    /// true if `quoter` is Uniswap QuoterV2 (struct argument), false for the original Quoter.
    #[serde(default)]
    pub quoter_v2: bool,
    /// Swap fee in bps for v2-style pools (default 30). Solidly pools read the fee from the factory.
    pub fee_bps: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairConfig {
    /// Symbol of the token that is flash-borrowed (must exist in [tokens]).
    pub base: String,
    /// Symbol of the intermediate token (must exist in [tokens]).
    pub quote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub min_net_profit_usd: f64,
    pub max_gas_per_tx: u64,
    pub daily_revert_loss_cap_usd: f64,
    pub consecutive_failure_limit: u32,
    pub dry_run: bool,
    /// Per-trade cap on the flash loan size, in USD.
    #[serde(default = "default_max_loan_usd")]
    pub max_loan_usd: f64,
    /// Extra per-trade cost (USD) added to gas, e.g. the L1 data fee on OP-stack chains,
    /// which eth_estimateGas does not include.
    #[serde(default)]
    pub extra_cost_usd: f64,
    #[serde(default)]
    pub excluded_tokens: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeneficiaryConfig {
    pub profit_recipient_address: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub auto_sweep: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerConfig {
    pub gas_wallet_address: String,
    #[serde(default)]
    pub label: String,
    /// Name of the environment variable holding the hex private key. The key itself is never in config.
    pub private_key_env: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DexKind {
    V2,
    V3,
    V3Router02,
    Solidly,
    Curve,
}

impl DexKind {
    pub fn parse(s: &str) -> eyre::Result<Self> {
        match s.trim().to_lowercase().as_str() {
            "v2" => Ok(DexKind::V2),
            "v3" => Ok(DexKind::V3),
            "v3_router02" => Ok(DexKind::V3Router02),
            "solidly" => Ok(DexKind::Solidly),
            "curve" => Ok(DexKind::Curve),
            other => eyre::bail!("unknown dex kind '{}'", other),
        }
    }

    pub fn is_v3(self) -> bool {
        matches!(self, DexKind::V3 | DexKind::V3Router02)
    }
}

impl DexConfig {
    pub fn kind_enum(&self) -> eyre::Result<DexKind> {
        DexKind::parse(&self.kind)
    }
}

pub fn parse_addr(s: &str) -> eyre::Result<Address> {
    Ok(s.trim().parse::<Address>()?)
}

impl ChainConfig {
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> eyre::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let mut config: ChainConfig = toml::from_str(&content)?;
        config.apply_env_overrides();
        config.validate()?;
        Ok(config)
    }

    fn apply_env_overrides(&mut self) {
        let suffix = self.chain_name.to_uppercase();
        if let Ok(v) = std::env::var(format!("RPC_HTTP_{}", suffix)) {
            if !v.trim().is_empty() {
                self.rpc_http = v.trim().to_string();
            }
        }
        if let Ok(v) = std::env::var(format!("RPC_WS_{}", suffix)) {
            if !v.trim().is_empty() {
                self.rpc_ws = v.trim().to_string();
            }
        }
    }

    fn validate(&self) -> eyre::Result<()> {
        if self.rpc_http.trim().is_empty() {
            eyre::bail!("[{}] rpc_http is empty", self.chain_name);
        }
        if self.tip_share_percent > 90 {
            eyre::bail!("[{}] tip_share_percent must be <= 90", self.chain_name);
        }
        for (name, dex) in &self.dexes {
            dex.kind_enum()
                .map_err(|e| eyre::eyre!("[{}] dex '{}': {}", self.chain_name, name, e))?;
        }
        for (sym, addr) in &self.tokens {
            parse_addr(addr)
                .map_err(|e| eyre::eyre!("[{}] token {} has a bad address: {}", self.chain_name, sym, e))?;
        }
        for p in &self.pairs {
            if !self.tokens.contains_key(&p.base) || !self.tokens.contains_key(&p.quote) {
                eyre::bail!("[{}] pair {}/{} references a token missing from [tokens]", self.chain_name, p.base, p.quote);
            }
        }
        parse_addr(&self.signer.gas_wallet_address)?;
        parse_addr(&self.beneficiary.profit_recipient_address)?;
        parse_addr(&self.flash_arb_contract)?;
        Ok(())
    }

    pub fn signer_address(&self) -> eyre::Result<Address> {
        parse_addr(&self.signer.gas_wallet_address)
    }

    pub fn flash_arb_address(&self) -> eyre::Result<Address> {
        parse_addr(&self.flash_arb_contract)
    }

    pub fn profit_recipient(&self) -> eyre::Result<Address> {
        parse_addr(&self.beneficiary.profit_recipient_address)
    }
}
