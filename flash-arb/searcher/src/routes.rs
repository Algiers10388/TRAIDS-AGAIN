//! Opportunity search using exact on-chain quotes.
//!
//! For every ordered pair of venues (A, B) on a token pair we borrow `base`, sell it for `quote` on A,
//! buy `base` back on B, and keep the difference after the Aave premium. Every number comes from a
//! quoter/router call at the current block, so fees, ticks and curve shape are all included.

use ethers::prelude::*;

use crate::abi;
use crate::config::{ChainConfig, DexKind};
use crate::monitor::{PairMarket, Venue};

#[derive(Debug, Clone)]
pub struct Opportunity {
    pub pair_label: String,
    pub base: Address,
    pub quote: Address,
    pub base_dec: u8,
    pub venue_a: Venue, // base -> quote
    pub venue_b: Venue, // quote -> base
    pub amount_in: U256,
    pub amount_out: U256,
    pub premium: U256,
    pub gross_profit: U256, // base units, after premium, before gas
}

pub async fn quote(provider: &Provider<Http>, v: &Venue, token_in: Address, token_out: Address, amount_in: U256) -> Option<U256> {
    let r = match v.kind {
        DexKind::V2 => abi::v2_amount_out(provider, v.router, amount_in, token_in, token_out).await,
        DexKind::V3 | DexKind::V3Router02 => match v.quoter {
            Some(q) => abi::v3_amount_out(provider, q, v.quoter_v2, token_in, token_out, v.v3_fee, amount_in).await,
            None => return None,
        },
        DexKind::Solidly => abi::solidly_amount_out(provider, v.router, v.factory, token_in, token_out, v.stable, amount_in).await,
        DexKind::Curve => return None,
    };
    r.ok().filter(|x| !x.is_zero())
}

fn premium_of(cfg: &ChainConfig, amount: U256) -> U256 {
    // Aave premium rounds up
    let bps = U256::from(cfg.aave_flash_fee_bps);
    (amount * bps + U256::from(9_999u64)) / U256::from(10_000u64)
}

/// Net result of the round trip for a given loan size, or None if either quote failed.
async fn evaluate(
    cfg: &ChainConfig,
    provider: &Provider<Http>,
    m: &PairMarket,
    a: &Venue,
    b: &Venue,
    amount: U256,
) -> Option<(U256, U256)> {
    let q = quote(provider, a, m.base, m.quote, amount).await?;
    let out = quote(provider, b, m.quote, m.base, q).await?;
    let owed = amount + premium_of(cfg, amount);
    if out > owed {
        Some((out, out - owed))
    } else {
        Some((out, U256::zero()))
    }
}

/// Finds the most profitable (A, B, size) for one pair. `max_amount` is the per-trade loan cap in base units.
pub async fn find_best(
    cfg: &ChainConfig,
    provider: &Provider<Http>,
    m: &PairMarket,
    max_amount: U256,
) -> Option<Opportunity> {
    if max_amount.is_zero() || m.venues.len() < 2 {
        return None;
    }
    let probe = (max_amount / U256::from(50u64)).max(U256::one());

    // 1. Screen: per-venue sell price (base->quote) and buy price (quote->base) at a probe size.
    let mut sell: Vec<Option<U256>> = Vec::new();
    for v in &m.venues {
        sell.push(quote(provider, v, m.base, m.quote, probe).await);
    }
    let mut known: Vec<U256> = sell.iter().flatten().cloned().collect();
    if known.len() < 2 {
        return None;
    }
    known.sort();
    let q_ref = known[known.len() / 2];
    let mut buy: Vec<Option<U256>> = Vec::new();
    for v in &m.venues {
        buy.push(quote(provider, v, m.quote, m.base, q_ref).await);
    }

    // factor(A,B) = (quote per base on A) * (base per quote on B), scaled by 1e6 against `probe`/`q_ref`
    let mut cands: Vec<(usize, usize, f64)> = Vec::new();
    for (i, s) in sell.iter().enumerate() {
        for (j, b) in buy.iter().enumerate() {
            if i == j {
                continue;
            }
            if let (Some(s), Some(b)) = (s, b) {
                let sell_ratio = s.as_u128() as f64 / q_ref.as_u128() as f64; // quote received vs reference
                let buy_ratio = b.as_u128() as f64 / probe.as_u128() as f64; // base received for q_ref vs probe
                let factor = sell_ratio * buy_ratio;
                let hurdle = 1.0 + (cfg.aave_flash_fee_bps as f64 + 2.0) / 10_000.0;
                if factor > hurdle {
                    cands.push((i, j, factor));
                }
            }
        }
    }
    cands.sort_by(|x, y| y.2.partial_cmp(&x.2).unwrap());
    cands.truncate(3);

    // 2. Size: coarse geometric grid, then a local refinement, using exact round-trip quotes.
    let mut best: Option<Opportunity> = None;
    for (i, j, _) in cands {
        let (a, b) = (&m.venues[i], &m.venues[j]);
        let lo = (max_amount / U256::from(64u64)).max(U256::one());
        let steps = 8u32;
        let ratio = (max_amount.as_u128() as f64 / lo.as_u128() as f64).powf(1.0 / steps as f64);
        let mut grid: Vec<U256> = (0..=steps)
            .map(|k| U256::from((lo.as_u128() as f64 * ratio.powi(k as i32)) as u128))
            .collect();
        let mut top: Option<(U256, U256, U256)> = None; // (amount, out, profit)
        for amt in grid.drain(..) {
            if amt.is_zero() {
                continue;
            }
            if let Some((out, profit)) = evaluate(cfg, provider, m, a, b, amt).await {
                if top.map_or(true, |t| profit > t.2) {
                    top = Some((amt, out, profit));
                }
            }
        }
        let Some((c_amt, c_out, c_profit)) = top else { continue };
        if c_profit.is_zero() {
            continue;
        }
        // refine around the coarse optimum
        let mut best_local = (c_amt, c_out, c_profit);
        for pct in [60u64, 75, 90, 110, 125, 150] {
            let amt = (c_amt * U256::from(pct) / U256::from(100u64)).min(max_amount);
            if amt.is_zero() {
                continue;
            }
            if let Some((out, profit)) = evaluate(cfg, provider, m, a, b, amt).await {
                if profit > best_local.2 {
                    best_local = (amt, out, profit);
                }
            }
        }
        let opp = Opportunity {
            pair_label: format!("{}/{}", m.base_sym, m.quote_sym),
            base: m.base,
            quote: m.quote,
            base_dec: m.base_dec,
            venue_a: a.clone(),
            venue_b: b.clone(),
            amount_in: best_local.0,
            amount_out: best_local.1,
            premium: premium_of(cfg, best_local.0),
            gross_profit: best_local.2,
        };
        if best.as_ref().map_or(true, |o| opp.gross_profit_f64() > o.gross_profit_f64()) {
            best = Some(opp);
        }
    }
    best
}

impl Opportunity {
    pub fn gross_profit_f64(&self) -> f64 {
        self.gross_profit.as_u128() as f64 / 10f64.powi(self.base_dec as i32)
    }

    pub fn leg1(&self) -> abi::LegParams {
        leg(&self.venue_a, self.base, self.quote)
    }

    pub fn leg2(&self) -> abi::LegParams {
        leg(&self.venue_b, self.quote, self.base)
    }
}

fn leg(v: &Venue, token_in: Address, token_out: Address) -> abi::LegParams {
    abi::LegParams {
        protocol: abi::protocol_id(v.kind),
        router_or_pool: v.router,
        token_in,
        token_out,
        v3_fee: v.v3_fee,
        factory: v.factory,
        stable: v.stable,
    }
}
