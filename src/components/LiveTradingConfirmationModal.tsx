import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Key,
  Lock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { CredentialsSummary } from '../types';

interface LiveTradingConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  credentialsSummary: CredentialsSummary | null;
}

export const LiveTradingConfirmationModal: React.FC<LiveTradingConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  credentialsSummary,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-[#0F1422] border border-rose-500/50 shadow-2xl shadow-rose-500/10 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rose-500/30 bg-rose-950/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                Enable Live Real Trading Mode
              </h2>
              <p className="text-[11px] text-rose-300">
                Direct execution on exchange order books using real capital
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs text-slate-300">
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
            <div className="text-white font-bold flex items-center gap-1.5 text-xs">
              <Key className="h-4 w-4 text-amber-400" />
              <span>Loaded Exchange API Credentials</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">NonKYC Exchange:</span>
                <span className={credentialsSummary?.NONKYC?.configured ? 'text-emerald-400' : 'text-slate-500'}>
                  {credentialsSummary?.NONKYC?.configured ? 'ACTIVE (HMAC-SHA256 Signed)' : 'NOT LOADED'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Kraken Financial:</span>
                <span className={credentialsSummary?.KRAKEN?.configured ? 'text-emerald-400' : 'text-slate-500'}>
                  {credentialsSummary?.KRAKEN?.configured ? 'ACTIVE (HMAC Signed)' : 'NOT LOADED'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Coinbase Pro / Advanced:</span>
                <span className={credentialsSummary?.COINBASE?.configured ? 'text-emerald-400' : 'text-slate-500'}>
                  {credentialsSummary?.COINBASE?.configured ? 'ACTIVE (CDP / API Key)' : 'NOT LOADED'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Binance Global:</span>
                <span className={credentialsSummary?.BINANCE?.configured ? 'text-emerald-400' : 'text-slate-500'}>
                  {credentialsSummary?.BINANCE?.configured ? 'ACTIVE (Spot Gateway)' : 'NOT LOADED'}
                </span>
              </div>
            </div>
          </div>

          {/* Operational Warnings */}
          <div className="space-y-2 p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/30 text-[11px] leading-relaxed">
            <div className="font-bold text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>Important Risk & Execution Safeguards</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-slate-300 font-mono">
              <li>
                In Live Mode, bot triggers and manual Buy/Sell orders will send real authenticated REST requests to the exchange matching engines.
              </li>
              <li>
                Live orders are subject to exchange taker fees, real market slippage, and available account cash on the respective exchange.
              </li>
              <li>
                You can toggle back to Paper Simulation mode instantly at any time from the top navigation bar.
              </li>
            </ul>
          </div>

          {/* User Acknowledgement Checkbox */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-0 cursor-pointer"
            />
            <span className="text-[11px] text-slate-300">
              I confirm that I understand real money trades will be executed with my exchange accounts, and I authorize the Smart Order Router to place real orders.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-900/60">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition-all"
          >
            Keep Paper Simulation
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={!acknowledged}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>Activate Live Real Trading</span>
          </button>
        </div>
      </div>
    </div>
  );
};
