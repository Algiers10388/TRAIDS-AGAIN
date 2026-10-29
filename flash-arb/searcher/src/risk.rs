use ethers::types::Address;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{error, warn};

use crate::config::{parse_addr, RiskConfig};

#[derive(Debug)]
struct State {
    consecutive_reverts: u32,
    tripped: bool,
    day: u64,
    daily_gas_loss_usd: f64,
}

#[derive(Debug, Clone)]
pub struct RiskManager {
    pub config: RiskConfig,
    excluded: Arc<Vec<Address>>,
    state: Arc<Mutex<State>>,
}

fn utc_day() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() / 86_400).unwrap_or(0)
}

impl RiskManager {
    pub fn new(config: RiskConfig) -> Self {
        let excluded = config
            .excluded_tokens
            .iter()
            .filter_map(|s| parse_addr(s).ok())
            .collect::<Vec<_>>();
        Self {
            config,
            excluded: Arc::new(excluded),
            state: Arc::new(Mutex::new(State {
                consecutive_reverts: 0,
                tripped: false,
                day: utc_day(),
                daily_gas_loss_usd: 0.0,
            })),
        }
    }

    fn roll_day(st: &mut State) {
        let today = utc_day();
        if st.day != today {
            st.day = today;
            st.daily_gas_loss_usd = 0.0;
        }
    }

    pub fn is_excluded(&self, token: Address) -> bool {
        self.excluded.contains(&token)
    }

    pub fn daily_loss(&self) -> f64 {
        let mut st = self.state.lock().unwrap();
        Self::roll_day(&mut st);
        st.daily_gas_loss_usd
    }

    pub fn is_tripped(&self) -> bool {
        self.state.lock().unwrap().tripped
    }

    /// Pre-execution safety check. Returns the reason when a trade must not be sent.
    pub fn can_execute(&self, tokens: &[Address], gas_units: u64) -> Result<(), String> {
        let mut st = self.state.lock().unwrap();
        Self::roll_day(&mut st);
        if st.tripped {
            return Err("circuit breaker is tripped".into());
        }
        if tokens.iter().any(|t| self.excluded.contains(t)) {
            return Err("token is on the excluded list".into());
        }
        if gas_units > self.config.max_gas_per_tx {
            return Err(format!("gas {} exceeds max_gas_per_tx {}", gas_units, self.config.max_gas_per_tx));
        }
        if st.daily_gas_loss_usd >= self.config.daily_revert_loss_cap_usd {
            st.tripped = true;
            return Err("daily revert-loss cap reached".into());
        }
        Ok(())
    }

    pub fn record_success(&self) {
        self.state.lock().unwrap().consecutive_reverts = 0;
    }

    pub fn record_revert(&self, gas_spent_usd: f64) {
        let mut st = self.state.lock().unwrap();
        Self::roll_day(&mut st);
        st.consecutive_reverts += 1;
        st.daily_gas_loss_usd += gas_spent_usd;
        warn!("on-chain revert #{} (gas lost ${:.2}, today ${:.2})", st.consecutive_reverts, gas_spent_usd, st.daily_gas_loss_usd);
        if st.consecutive_reverts >= self.config.consecutive_failure_limit {
            error!("CIRCUIT BREAKER TRIPPED after {} consecutive reverts", st.consecutive_reverts);
            st.tripped = true;
        }
        if st.daily_gas_loss_usd >= self.config.daily_revert_loss_cap_usd {
            error!("DAILY LOSS CAP reached (${:.2} >= ${:.2})", st.daily_gas_loss_usd, self.config.daily_revert_loss_cap_usd);
            st.tripped = true;
        }
    }
}
