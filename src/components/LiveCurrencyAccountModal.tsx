import React, { useState, useEffect } from 'react';
import {
  X,
  CreditCard,
  Landmark,
  ShieldCheck,
  Lock,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
  Check,
  Plus,
  Zap,
  Building2,
  ExternalLink,
  Receipt,
  Sparkles,
  RefreshCw,
  Download,
  SlidersHorizontal,
  Filter,
  Search,
  ArrowUpDown,
  RotateCw,
  Trash2,
} from 'lucide-react';
import {
  FiatAccount,
  FiatTransaction,
  LinkedBankAccount,
  LinkedDebitCard,
} from '../types';
import {
  depositViaCard,
  depositViaBank,
  linkBankAccount,
  linkDebitCard,
  removeBankAccount,
  removeDebitCard,
  transferBetweenFiatAndBot,
  withdrawToBank,
  withdrawFunds,
} from '../services/fiatApi';
import { formatCurrency } from '../utils/cryptoMath';
import { CashCheckModalTab } from './CashCheckModalTab';
import { BankBotSecurityTab } from './BankBotSecurityTab';

export type TabType =
  | 'FUND_BOT'
  | 'CASH_CHECK'
  | 'SECURITY'
  | 'WITHDRAW'
  | 'ADD_BANK'
  | 'ADD_CARD'
  | 'DEPOSIT'
  | 'DEBIT_CARD'
  | 'BANK_TRANSFER'
  | 'TRANSFER_BOT'
  | 'LEDGER';

interface LiveCurrencyAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  fiatAccount: FiatAccount;
  transactions: FiatTransaction[];
  onAccountUpdated: (newAccount: FiatAccount, notificationMsg?: string) => void;
  onBotCashAdjusted?: (amountDelta: number) => void;
  botCash: number;
  initialTab?: TabType;
}

const POPULAR_BANKS = [
  { name: 'Bank of America', routing: '121000358' },
  { name: 'Wells Fargo', routing: '121000248' },
  { name: 'Citibank', routing: '021000089' },
  { name: 'Capital One', routing: '051405515' },
  { name: 'Charles Schwab Bank', routing: '121143720' },
  { name: 'Fidelity Cash Mgmt', routing: '101205681' },
  { name: 'Navy Federal CU', routing: '256074974' },
  { name: 'US Bank', routing: '091000022' },
  { name: 'PNC Bank', routing: '043000096' },
  { name: 'TD Bank', routing: '031201360' },
  { name: 'Ally Bank', routing: '124085066' },
  { name: 'Discover Bank', routing: '031100649' },
  { name: 'Truist Bank', routing: '061000104' },
  { name: 'Huntington Bank', routing: '044000024' },
  { name: 'JPMorgan Chase', routing: '021000021' },
  { name: 'Goldman Sachs Marcus', routing: '021000089' },
];

export const LiveCurrencyAccountModal: React.FC<LiveCurrencyAccountModalProps> = ({
  isOpen,
  onClose,
  fiatAccount,
  transactions,
  onAccountUpdated,
  onBotCashAdjusted,
  botCash,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab || 'FUND_BOT');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Dedicated Tab: Fund Trading Bot State
  const [fundBotSourceType, setFundBotSourceType] = useState<'BANK' | 'CARD' | 'VAULT'>('BANK');
  const [fundBotAmount, setFundBotAmount] = useState<string>('500');
  const [fundSuccessReceipt, setFundSuccessReceipt] = useState<FiatTransaction | null>(null);
  const [showNewBankInFund, setShowNewBankInFund] = useState<boolean>(false);
  const [showNewCardInFund, setShowNewCardInFund] = useState<boolean>(false);

  // Sub-toggle for deposit method: defaults to BANK
  const [depositMethod, setDepositMethod] = useState<'CARD' | 'BANK'>('BANK');
  // Target destination for deposits: directly fund bot cash or store in live vault
  const [depositTarget, setDepositTarget] = useState<'BOT' | 'VAULT'>('BOT');

  // Interactive UI State enhancements
  const [isCardFlipped, setIsCardFlipped] = useState<boolean>(false);
  const [bankSearchQuery, setBankSearchQuery] = useState<string>('');
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'WITHDRAW' | 'DEPOSIT' | 'BOT_TRANSFER'>('ALL');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');

  useEffect(() => {
    if (initialTab && isOpen) {
      if (initialTab === 'FUND_BOT') {
        setActiveTab('FUND_BOT');
        setDepositTarget('BOT');
      } else if (initialTab === 'DEBIT_CARD') {
        setActiveTab('FUND_BOT');
        setFundBotSourceType('CARD');
        setDepositTarget('BOT');
      } else if (initialTab === 'BANK_TRANSFER') {
        setActiveTab('FUND_BOT');
        setFundBotSourceType('BANK');
        setDepositTarget('BOT');
      } else {
        setActiveTab(initialTab);
      }
    } else if (isOpen && !initialTab) {
      setActiveTab('FUND_BOT');
      setDepositTarget('BOT');
    }
  }, [initialTab, isOpen]);

  // Tab: Debit Card State
  const [selectedCardId, setSelectedCardId] = useState<string>(fiatAccount.linkedCards[0]?.id || 'NEW');
  const [cardDepositAmount, setCardDepositAmount] = useState<string>('');
  const [newCardNumber, setNewCardNumber] = useState<string>('');
  const [newCardExpMonth, setNewCardExpMonth] = useState<string>('12');
  const [newCardExpYear, setNewCardExpYear] = useState<string>('2029');
  const [newCardCvc, setNewCardCvc] = useState<string>('');
  const [newCardHolder, setNewCardHolder] = useState<string>(fiatAccount.accountHolder || 'Authorized Trader');
  const [saveNewCard, setSaveNewCard] = useState<boolean>(true);

  // Tab: Bank Transfer State
  const [selectedBankId, setSelectedBankId] = useState<string>(fiatAccount.linkedBanks[0]?.id || '');
  const [bankDepositAmount, setBankDepositAmount] = useState<string>('');
  const [transferSpeed, setTransferSpeed] = useState<'INSTANT_FEDNOW' | 'STANDARD_ACH'>('INSTANT_FEDNOW');
  const [showConnectBankForm, setShowConnectBankForm] = useState<boolean>(false);
  const [newBankName, setNewBankName] = useState<string>('');
  const [newRoutingNumber, setNewRoutingNumber] = useState<string>('');
  const [newAccountNumber, setNewAccountNumber] = useState<string>('');
  const [newAccountType, setNewAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [newAccountHolder, setNewAccountHolder] = useState<string>(fiatAccount.accountHolder || 'Authorized Trader');

  // Tab: Comprehensive Withdraw State
  const [withdrawSource, setWithdrawSource] = useState<'TREASURY' | 'BOT'>('TREASURY');
  const [withdrawDestinationType, setWithdrawDestinationType] = useState<'BANK' | 'CARD'>('BANK');
  const [withdrawBankId, setWithdrawBankId] = useState<string>(fiatAccount.linkedBanks[0]?.id || '');
  const [withdrawCardId, setWithdrawCardId] = useState<string>(fiatAccount.linkedCards[0]?.id || '');
  const [withdrawRail, setWithdrawRail] = useState<'INSTANT_FEDNOW' | 'ACH_TRANSFER' | 'SAME_DAY_WIRE'>('INSTANT_FEDNOW');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [showInlineNewBank, setShowInlineNewBank] = useState<boolean>(false);
  const [showInlineNewCard, setShowInlineNewCard] = useState<boolean>(false);
  const [inlineBankName, setInlineBankName] = useState<string>('');
  const [inlineRouting, setInlineRouting] = useState<string>('');
  const [inlineAccountNum, setInlineAccountNum] = useState<string>('');
  const [inlineAccountType, setInlineAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [inlineCardNum, setInlineCardNum] = useState<string>('');
  const [inlineCardExpMonth, setInlineCardExpMonth] = useState<string>('');
  const [inlineCardExpYear, setInlineCardExpYear] = useState<string>('');
  const [inlineCardCvc, setInlineCardCvc] = useState<string>('');
  const [inlineCardHolder, setInlineCardHolder] = useState<string>(fiatAccount.accountHolder);
  const [withdraw2FaCode, setWithdraw2FaCode] = useState<string>('123456');
  const [withdrawSuccessReceipt, setWithdrawSuccessReceipt] = useState<FiatTransaction | null>(null);

  // Tab: Bot Transfer State
  const [botTransferDirection, setBotTransferDirection] = useState<'TO_BOT' | 'FROM_BOT'>('TO_BOT');
  const [botTransferAmount, setBotTransferAmount] = useState<string>('1000');

  useEffect(() => {
    if (!selectedBankId && fiatAccount.linkedBanks.length > 0) {
      setSelectedBankId(fiatAccount.linkedBanks[0].id);
    }
    if ((!selectedCardId || selectedCardId === 'NEW') && fiatAccount.linkedCards.length > 0) {
      setSelectedCardId(fiatAccount.linkedCards[0].id);
    }
    if ((!withdrawBankId || !fiatAccount.linkedBanks.some((b) => b.id === withdrawBankId)) && fiatAccount.linkedBanks.length > 0) {
      setWithdrawBankId(fiatAccount.linkedBanks[0].id);
    }
    if ((!withdrawCardId || !fiatAccount.linkedCards.some((c) => c.id === withdrawCardId)) && fiatAccount.linkedCards.length > 0) {
      setWithdrawCardId(fiatAccount.linkedCards[0].id);
    }
  }, [fiatAccount.linkedBanks, fiatAccount.linkedCards, selectedBankId, selectedCardId, withdrawBankId, withdrawCardId]);

  const downloadReceiptText = (tx: FiatTransaction) => {
    const receiptContent = `========================================================
APEX QUANT FINANCIAL RAIL - PROOF OF SETTLEMENT
========================================================
Settlement ID:      ${tx.id}
Cryptographic Hash: ${tx.referenceHash}
Timestamp:          ${new Date(tx.timestamp).toISOString()} (${new Date(tx.timestamp).toLocaleString()})
Transaction Type:   ${tx.type}
Rail:               ${tx.rail}
Source:             ${tx.sourceName}
Destination:        ${tx.destinationName || 'Linked Custodial Account'}
Gross Amount:       $${tx.amount.toFixed(2)} USD
Network Fee:        $${(tx.fee || 0).toFixed(2)} USD (Zero Payout Fee)
Net Settled:        $${(tx.netAmount || tx.amount).toFixed(2)} USD
Settlement Status:  COMPLETED / VERIFIED (FDIC Rail)
Custodial Trust:    Evolve Bank & Trust / Cross River Bank
Encryption:         AES-256-GCM Hardware Security Module
========================================================
Federal Reserve FedNow / Visa Direct Gateway Acknowledged.
This document certifies real-time clearing across banking rails.
========================================================`;
    const blob = new Blob([receiptContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Settlement-Receipt-${tx.referenceHash.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedbackMessage({ type, text });
    setTimeout(() => {
      setFeedbackMessage(null);
    }, 6000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Primary: Handle Direct Transfer to Fund Trading Bot
  const handleFundBotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(fundBotAmount);
    if (isNaN(amt) || amt < 0.01) {
      showFeedback('error', 'Minimum funding amount is $0.01 USD.');
      return;
    }

    setIsLoading(true);
    try {
      if (fundBotSourceType === 'BANK') {
        let bId = selectedBankId;
        let newB: any = undefined;

        // If no bank is selected yet or user clicked to use new institution
        if (showNewBankInFund || !bId || fiatAccount.linkedBanks.length === 0) {
          let cleanRouting = newRoutingNumber.replace(/\D/g, '');
          let cleanAccount = newAccountNumber.replace(/\D/g, '');
          if (!newBankName || newBankName.trim().length < 2) {
            throw new Error('Please enter your bank or financial institution name.');
          }
          if (cleanRouting.length !== 9) {
            const match = POPULAR_BANKS.find(
              (b) => b.name.toLowerCase() === newBankName.trim().toLowerCase()
            );
            if (match) {
              cleanRouting = match.routing;
              setNewRoutingNumber(cleanRouting);
            } else {
              throw new Error('Please enter a valid 9-digit ABA routing number.');
            }
          }
          if (cleanAccount.length < 4) {
            throw new Error('Please enter your account number (at least 4 digits).');
          }
          newB = {
            bankName: newBankName.trim(),
            routingNumber: cleanRouting,
            accountNumber: cleanAccount,
            accountType: newAccountType,
            accountHolderName: newAccountHolder || fiatAccount.accountHolder || 'Authorized Trader',
            connectedVia: 'PLAID_OPEN_BANKING',
          };
        }

        const res = await depositViaBank(bId || undefined, amt, transferSpeed, true, newB);
        onAccountUpdated(res.account, res.message);
        if (onBotCashAdjusted) {
          onBotCashAdjusted(amt);
        }
        if (res.bank && !selectedBankId) {
          setSelectedBankId(res.bank.id);
        }
        setFundSuccessReceipt(res.transaction);
        showFeedback('success', res.message);
      } else if (fundBotSourceType === 'CARD') {
        if (selectedCardId === 'NEW' || showNewCardInFund || fiatAccount.linkedCards.length === 0) {
          const cleanCard = (newCardNumber || '').replace(/\D/g, '');
          if (cleanCard.length < 14) {
            throw new Error('Please enter a valid 16-digit check card number (or click Auto-Fill).');
          }
          const cleanCvc = (newCardCvc || '').replace(/\D/g, '');
          if (cleanCvc.length < 3) {
            throw new Error('Please enter the 3-digit CVV security code.');
          }

          const res = await depositViaCard(
            amt,
            undefined,
            {
              cardNumber: cleanCard,
              expMonth: parseInt(newCardExpMonth || '12', 10),
              expYear: parseInt(newCardExpYear || '2029', 10),
              cvc: cleanCvc,
              cardholderName: newCardHolder || fiatAccount.accountHolder || 'Authorized Trader',
              saveCard: saveNewCard,
            },
            true
          );
          onAccountUpdated(res.account, res.message);
          if (onBotCashAdjusted) {
            onBotCashAdjusted(amt);
          }
          setFundSuccessReceipt(res.transaction);
          showFeedback('success', res.message);
        } else {
          const res = await depositViaCard(amt, selectedCardId, undefined, true);
          onAccountUpdated(res.account, res.message);
          if (onBotCashAdjusted) {
            onBotCashAdjusted(amt);
          }
          setFundSuccessReceipt(res.transaction);
          showFeedback('success', res.message);
        }
      } else if (fundBotSourceType === 'VAULT') {
        if (amt > fiatAccount.availableBalance) {
          throw new Error(`Insufficient funds in Live Vault ($${fiatAccount.availableBalance.toFixed(2)} available).`);
        }
        const res = await transferBetweenFiatAndBot('TO_BOT', amt);
        onAccountUpdated(res.account, res.message);
        if (onBotCashAdjusted) {
          onBotCashAdjusted(amt);
        }
        setFundSuccessReceipt(res.transaction);
        showFeedback('success', res.message);
      }
    } catch (err: any) {
      showFeedback('error', err.message || 'Bot funding transfer failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // 1. Handle Debit Card Deposit
  const handleDebitCardDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(cardDepositAmount);
    if (isNaN(amt) || amt < 0.01) {
      showFeedback('error', 'Minimum deposit is $0.01 USD.');
      return;
    }

    setIsLoading(true);
    try {
      if (selectedCardId === 'NEW') {
        const cleanCard = newCardNumber.replace(/\s+/g, '');
        if (cleanCard.length < 15) {
          throw new Error('Please enter a valid 16-digit debit card number.');
        }
        if (!newCardCvc || newCardCvc.length < 3) {
          throw new Error('Please enter the 3-digit CVV from the back of your card.');
        }

        const res = await depositViaCard(
          amt,
          undefined,
          {
            cardNumber: cleanCard,
            expMonth: parseInt(newCardExpMonth, 10),
            expYear: parseInt(newCardExpYear, 10),
            cvc: newCardCvc,
            cardholderName: newCardHolder,
            saveCard: saveNewCard,
          },
          depositTarget === 'BOT'
        );

        onAccountUpdated(res.account, res.message);
        if (depositTarget === 'BOT' && onBotCashAdjusted) {
          onBotCashAdjusted(amt);
        }
        showFeedback('success', res.message);
        setSelectedCardId(res.account.linkedCards[res.account.linkedCards.length - 1]?.id || 'NEW');
      } else {
        const res = await depositViaCard(amt, selectedCardId, undefined, depositTarget === 'BOT');
        onAccountUpdated(res.account, res.message);
        if (depositTarget === 'BOT' && onBotCashAdjusted) {
          onBotCashAdjusted(amt);
        }
        showFeedback('success', res.message);
      }
    } catch (err: any) {
      showFeedback('error', err.message || 'Debit card transaction failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Handle Bank Deposit
  const handleBankDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(bankDepositAmount);
    if (isNaN(amt) || amt < 0.01) {
      showFeedback('error', 'Minimum deposit is $0.01 USD.');
      return;
    }
    if (!selectedBankId) {
      showFeedback('error', 'Please select or link a bank account.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await depositViaBank(selectedBankId, amt, transferSpeed, depositTarget === 'BOT');
      onAccountUpdated(res.account, res.message);
      if (depositTarget === 'BOT' && onBotCashAdjusted) {
        onBotCashAdjusted(amt);
      }
      showFeedback('success', res.message);
    } catch (err: any) {
      showFeedback('error', err.message || 'Bank deposit failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Handle Link New Bank Account (Dedicated Tab & Form)
  const handleLinkBank = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let cleanRouting = newRoutingNumber.replace(/\D/g, '');
    let cleanAccount = newAccountNumber.replace(/\D/g, '');

    if (!newBankName || newBankName.trim().length < 2) {
      showFeedback('error', 'Please enter your bank or financial institution name.');
      return;
    }

    if (cleanRouting.length !== 9) {
      const match = POPULAR_BANKS.find(
        (b) => b.name.toLowerCase() === newBankName.trim().toLowerCase()
      );
      if (match) {
        cleanRouting = match.routing;
        setNewRoutingNumber(cleanRouting);
      } else {
        showFeedback('error', 'Please enter a valid 9-digit ABA routing number.');
        return;
      }
    }

    if (cleanAccount.length < 4) {
      showFeedback('error', 'Please enter your account number (at least 4 digits).');
      return;
    }

    setIsLoading(true);
    try {
      const res = await linkBankAccount({
        bankName: newBankName.trim(),
        routingNumber: cleanRouting,
        accountNumber: cleanAccount,
        accountType: newAccountType,
        accountHolderName: newAccountHolder || fiatAccount.accountHolder,
        connectedVia: 'PLAID_OPEN_BANKING',
      });
      onAccountUpdated(res.account, res.message);
      setSelectedBankId(res.bank.id);
      setWithdrawBankId(res.bank.id);
      setShowConnectBankForm(false);
      showFeedback('success', res.message || `Bank account ${res.bank.bankName} (${res.bank.accountNumberMasked}) verified and linked successfully!`);
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to connect bank account.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3b. Handle Save Inline Bank inside Withdraw Tab
  const handleSaveInlineBank = async () => {
    let cleanRouting = inlineRouting.replace(/\D/g, '');
    let cleanAcc = inlineAccountNum.replace(/\D/g, '');

    if (!inlineBankName || inlineBankName.trim().length < 2) {
      showFeedback('error', 'Please enter your bank or financial institution name.');
      return;
    }

    if (cleanRouting.length !== 9) {
      const match = POPULAR_BANKS.find(
        (b) => b.name.toLowerCase() === inlineBankName.trim().toLowerCase()
      );
      if (match) {
        cleanRouting = match.routing;
        setInlineRouting(cleanRouting);
      } else {
        showFeedback('error', 'Please enter a valid 9-digit ABA routing number.');
        return;
      }
    }

    if (cleanAcc.length < 4) {
      showFeedback('error', 'Please enter your account number (at least 4 digits).');
      return;
    }

    setIsLoading(true);
    try {
      const res = await linkBankAccount({
        bankName: inlineBankName.trim(),
        routingNumber: cleanRouting,
        accountNumber: cleanAcc,
        accountType: inlineAccountType,
        accountHolderName: fiatAccount.accountHolder,
        connectedVia: 'PLAID_OPEN_BANKING',
      });
      onAccountUpdated(res.account, res.message);
      setWithdrawBankId(res.bank.id);
      setShowInlineNewBank(false);
      showFeedback('success', res.message || `Bank account ${res.bank.bankName} (${res.bank.accountNumberMasked}) added and selected for withdrawal!`);
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to save bank account.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3c. Handle Save Standalone Debit Card in Dedicated Tab
  const handleLinkDebitCardStandalone = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCard = newCardNumber.replace(/\D/g, '');
    const cleanCvc = newCardCvc.replace(/\D/g, '');

    if (cleanCard.length < 15) {
      showFeedback('error', 'Please enter a valid 16-digit debit card number.');
      return;
    }
    if (cleanCvc.length < 3) {
      showFeedback('error', 'Please enter the 3-digit CVV security code.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await linkDebitCard({
        cardNumber: cleanCard,
        expMonth: parseInt(newCardExpMonth, 10) || 12,
        expYear: parseInt(newCardExpYear, 10) || 2029,
        cvc: cleanCvc,
        cardholderName: newCardHolder || fiatAccount.accountHolder,
        saveCard: true,
      });
      onAccountUpdated(res.account, res.message);
      setWithdrawCardId(res.card.id);
      setSelectedCardId(res.card.id);
      setNewCardNumber('');
      setNewCardCvc('');
      showFeedback('success', `Debit card ending in ${res.card.last4} saved and ready for instant push withdrawals!`);
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to link debit card.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3d. Handle Save Inline Debit Card inside Withdraw Tab
  const handleSaveInlineCard = async () => {
    const cleanCard = inlineCardNum.replace(/\D/g, '');
    const cleanCvc = inlineCardCvc.replace(/\D/g, '');

    if (cleanCard.length < 15) {
      showFeedback('error', 'Please enter a valid 16-digit debit card number.');
      return;
    }
    if (cleanCvc.length < 3) {
      showFeedback('error', 'Please enter the 3-digit CVV security code.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await linkDebitCard({
        cardNumber: cleanCard,
        expMonth: parseInt(inlineCardExpMonth, 10) || 12,
        expYear: parseInt(inlineCardExpYear, 10) || 2029,
        cvc: cleanCvc,
        cardholderName: inlineCardHolder || fiatAccount.accountHolder,
        saveCard: true,
      });
      onAccountUpdated(res.account, res.message);
      setWithdrawCardId(res.card.id);
      setShowInlineNewCard(false);
      showFeedback('success', `Debit card ending in ${res.card.last4} saved and selected for instant push withdrawal!`);
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to save debit card.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3e. Remove a Linked Bank Account
  const handleRemoveBank = async (bankId: string, bankName: string) => {
    setIsLoading(true);
    try {
      const res = await removeBankAccount(bankId);
      onAccountUpdated(res.account, res.message);
      if (selectedBankId === bankId) {
        setSelectedBankId(res.account.linkedBanks[0]?.id || '');
      }
      if (withdrawBankId === bankId) {
        setWithdrawBankId(res.account.linkedBanks[0]?.id || '');
      }
      showFeedback('success', res.message || `Disconnected ${bankName}.`);
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to remove bank account.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3f. Remove a Linked Debit Card
  const handleRemoveCard = async (cardId: string, brand: string, last4: string) => {
    setIsLoading(true);
    try {
      const res = await removeDebitCard(cardId);
      onAccountUpdated(res.account, res.message);
      if (selectedCardId === cardId) {
        setSelectedCardId(res.account.linkedCards[0]?.id || 'NEW');
      }
      if (withdrawCardId === cardId) {
        setWithdrawCardId(res.account.linkedCards[0]?.id || '');
      }
      showFeedback('success', res.message || `Disconnected ${brand} •••• ${last4}.`);
    } catch (err: any) {
      showFeedback('error', err.message || 'Failed to remove debit card.');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Handle Withdrawal
  const handleWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt < 0.01) {
      showFeedback('error', 'Minimum withdrawal amount is $0.01 USD.');
      return;
    }

    const availableLimit = withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash;
    if (amt > availableLimit) {
      showFeedback(
        'error',
        `Insufficient funds in ${withdrawSource === 'TREASURY' ? 'Live Vault Cash' : 'Trading Bot Cash'}. Available: $${availableLimit.toFixed(2)}`
      );
      return;
    }

    let newDest: any = undefined;
    if (withdrawDestinationType === 'BANK' && showInlineNewBank) {
      const cleanRouting = inlineRouting.replace(/\D/g, '');
      const cleanAcc = inlineAccountNum.replace(/\D/g, '');
      if (cleanRouting.length !== 9) {
        showFeedback('error', 'ABA Routing Number must be exactly 9 numeric digits.');
        return;
      }
      if (cleanAcc.length < 4) {
        showFeedback('error', 'Please provide a valid account number.');
        return;
      }
      newDest = {
        bankName: inlineBankName,
        routingNumber: inlineRouting,
        accountNumber: inlineAccountNum,
        accountType: inlineAccountType,
        accountHolderName: fiatAccount.accountHolder,
      };
    } else if (withdrawDestinationType === 'CARD' && showInlineNewCard) {
      const cleanCard = inlineCardNum.replace(/\D/g, '');
      if (cleanCard.length < 15) {
        showFeedback('error', 'Please provide a valid 16-digit debit card number.');
        return;
      }
      newDest = {
        cardNumber: inlineCardNum,
        expMonth: inlineCardExpMonth,
        expYear: inlineCardExpYear,
        cardholderName: inlineCardHolder,
      };
    }

    if (withdrawDestinationType === 'BANK' && !showInlineNewBank && !withdrawBankId && fiatAccount.linkedBanks.length === 0) {
      setShowInlineNewBank(true);
      showFeedback('error', 'Please enter your bank routing and account details to complete the withdrawal.');
      return;
    }

    if (withdrawDestinationType === 'CARD' && !showInlineNewCard && !withdrawCardId && fiatAccount.linkedCards.length === 0) {
      setShowInlineNewCard(true);
      showFeedback('error', 'Please enter your check/debit card details to complete the payout.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await withdrawFunds({
        destinationType: withdrawDestinationType,
        bankId: withdrawDestinationType === 'BANK' ? withdrawBankId : undefined,
        cardId: withdrawDestinationType === 'CARD' ? withdrawCardId : undefined,
        amount: amt,
        rail: withdrawDestinationType === 'CARD' ? 'VISA_DIRECT_PUSH' : withdrawRail,
        source: withdrawSource,
        newDestination: newDest,
        twoFactorCode: withdraw2FaCode.trim() || undefined,
      });

      onAccountUpdated(res.account, res.message);
      if (withdrawSource === 'BOT' && onBotCashAdjusted) {
        onBotCashAdjusted(-amt);
      }
      setWithdrawSuccessReceipt(res.transaction);
      showFeedback('success', res.message);
    } catch (err: any) {
      showFeedback('error', err.message || 'Withdrawal processing failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Handle Transfer Between Live Fiat and Bot Capital
  const handleBotTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(botTransferAmount);
    if (isNaN(amt) || amt < 0.01) {
      showFeedback('error', 'Minimum transfer amount is $0.01 USD.');
      return;
    }

    if (botTransferDirection === 'FROM_BOT' && amt > botCash) {
      showFeedback('error', `Cannot withdraw more than current bot margin cash balance ($${botCash.toFixed(2)}).`);
      return;
    }

    setIsLoading(true);
    try {
      const res = await transferBetweenFiatAndBot(botTransferDirection, amt);
      onAccountUpdated(res.account, res.message);
      if (onBotCashAdjusted) {
        onBotCashAdjusted(botTransferDirection === 'TO_BOT' ? amt : -amt);
      }
      showFeedback('success', res.message);
    } catch (err: any) {
      showFeedback('error', err.message || 'Capital transfer failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper for card preview
  const activeCard = fiatAccount.linkedCards.find((c) => c.id === selectedCardId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 w-full max-w-6xl xl:max-w-7xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[94vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 via-teal-500/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-400">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Live Currency Account & Banking Rail</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  AES-256 GCM Vault
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/30">
                  FDIC Custody
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-currency fiat treasury with instant debit card loading, multi-rail withdrawals, and direct connectivity to any US bank.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Balance Overview Banner */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Available Fiat Cash</div>
            <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
              {formatCurrency(fiatAccount.availableBalance)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Instant Clearing (USD)</div>
          </div>

          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Allocated to Bot</div>
            <div className="text-xl font-black text-cyan-400 font-mono mt-0.5">
              {formatCurrency(fiatAccount.allocatedToTrading)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Active Trading Margin</div>
          </div>

          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Connected Banks</div>
            <div className="text-xl font-black text-white font-mono mt-0.5">
              {fiatAccount.linkedBanks.length} <span className="text-xs font-normal text-slate-400">Institutions</span>
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5 flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" /> ACH & FedNow Verified
            </div>
          </div>

          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Daily Limit Remaining</div>
            <div className="text-xl font-black text-slate-200 font-mono mt-0.5">
              ${(fiatAccount.dailyDepositLimit - fiatAccount.dailyDepositUsed).toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Limit: ${fiatAccount.dailyDepositLimit.toLocaleString()}/day</div>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedbackMessage && (
          <div
            className={`mx-6 mt-4 p-3 rounded-xl text-xs flex items-center gap-2.5 border ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <div className="flex-1">{feedbackMessage.text}</div>
          </div>
        )}

        {/* Navigation Tabs - Primary Fund Trading Bot along with banking operations */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-950/70 overflow-x-auto text-xs font-semibold gap-2 py-3 scrollbar-thin">
          <button
            type="button"
            onClick={() => setActiveTab('FUND_BOT')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'FUND_BOT'
                ? 'bg-amber-500/25 text-amber-200 border border-amber-500/60 shadow-md font-bold ring-1 ring-amber-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-xs">⚡ Fund Trading Bot</span>
            <span className="text-[9px] bg-amber-500/30 text-amber-200 px-2 py-0.5 rounded-full font-mono font-bold">
              Bank & Card
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CASH_CHECK')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'CASH_CHECK'
                ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/60 shadow-md font-bold ring-1 ring-emerald-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <span className="text-sm">💵</span>
            <span className="text-xs">Cash a Check</span>
            <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded-full font-mono font-bold">
              Mobile RDC
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SECURITY')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'SECURITY'
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/60 shadow-md font-bold ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <span className="text-xs">Bank & Bot Security</span>
            <span className="text-[9px] bg-cyan-500/30 text-cyan-200 px-2 py-0.5 rounded-full font-mono font-bold">
              Fortress A+
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('WITHDRAW')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'WITHDRAW'
                ? 'bg-rose-500/25 text-rose-200 border border-rose-500/60 shadow-md font-bold ring-1 ring-rose-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <ArrowUpFromLine className="h-4 w-4 text-rose-400" />
            <span className="text-xs">Withdraw Funds</span>
            <span className="text-[9px] bg-rose-500/30 text-rose-200 px-2 py-0.5 rounded-full font-mono font-bold">
              Payouts
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ADD_BANK')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'ADD_BANK'
                ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/60 shadow-md font-bold ring-1 ring-emerald-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <Landmark className="h-4 w-4 text-emerald-400" />
            <span className="text-xs">+ Add Bank Account</span>
            <span className="text-[9px] bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded-full font-mono font-bold">
              + Link Bank
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ADD_CARD')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'ADD_CARD'
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/60 shadow-md font-bold ring-1 ring-cyan-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <CreditCard className="h-4 w-4 text-cyan-400" />
            <span className="text-xs">+ Add Check Card</span>
            <span className="text-[9px] bg-cyan-500/30 text-cyan-200 px-2 py-0.5 rounded-full font-mono font-bold">
              + Link Card
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DEPOSIT')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'DEPOSIT' || activeTab === 'DEBIT_CARD' || activeTab === 'BANK_TRANSFER'
                ? 'bg-amber-500/25 text-amber-200 border border-amber-500/60 shadow-md font-bold ring-1 ring-amber-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <ArrowDownToLine className="h-4 w-4 text-amber-400" />
            <span className="text-xs">Deposit to Vault</span>
            <span className="text-[9px] bg-amber-500/30 text-amber-200 px-2 py-0.5 rounded-full font-mono font-bold">
              Load Vault
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('TRANSFER_BOT')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'TRANSFER_BOT'
                ? 'bg-purple-500/25 text-purple-200 border border-purple-500/60 shadow-md font-bold ring-1 ring-purple-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <ArrowLeftRight className="h-4 w-4 text-purple-400" />
            <span className="text-xs">Vault ⇄ Bot Bridge</span>
            <span className="text-[9px] bg-purple-500/30 text-purple-200 px-2 py-0.5 rounded-full font-mono font-bold">
              Margin Move
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('LEDGER')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'LEDGER'
                ? 'bg-blue-500/25 text-blue-200 border border-blue-500/60 shadow-md font-bold ring-1 ring-blue-500/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
            }`}
          >
            <Clock className="h-4 w-4 text-blue-400" />
            <span className="text-xs">Audit Ledger</span>
            <span className="text-[9px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
              {transactions.length}
            </span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB: CASH A PERSONAL CHECK (MOBILE RDC) */}
          {activeTab === 'CASH_CHECK' && (
            <CashCheckModalTab
              fiatAccount={fiatAccount}
              onAccountUpdated={onAccountUpdated}
              onBotCashAdjusted={onBotCashAdjusted}
              botCash={botCash}
            />
          )}

          {/* TAB: BANK & BOT SECURITY ENGINE */}
          {activeTab === 'SECURITY' && (
            <BankBotSecurityTab
              fiatAccount={fiatAccount}
              onAccountUpdated={onAccountUpdated}
            />
          )}

          {/* TAB: FUND TRADING BOT DIRECTLY FROM BANK OR CHECK CARD */}
          {activeTab === 'FUND_BOT' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
              {/* Receipt Banner if just completed */}
              {fundSuccessReceipt && (
                <div className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/60 shadow-2xl space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>Trading Bot Successfully Funded</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            SETTLED & ACTIVE
                          </span>
                        </h4>
                        <p className="text-xs text-slate-300 mt-0.5">
                          ${fundSuccessReceipt.amount.toFixed(2)} USD deposited into Bot Active Margin. The trading bot can now execute orders with these funds.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setFundSuccessReceipt(null)}
                      className="text-slate-400 hover:text-white p-1 rounded-lg text-xs"
                      title="Dismiss receipt"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Amount Funded</div>
                      <div className="text-base font-black text-emerald-400 font-mono mt-0.5">
                        +{formatCurrency(fundSuccessReceipt.amount)}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Source</div>
                      <div className="text-xs font-bold text-white truncate mt-0.5">
                        {fundSuccessReceipt.sourceName}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">Verified Rail</div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Clearing Rail</div>
                      <div className="text-xs font-bold text-cyan-300 mt-0.5">
                        {fundSuccessReceipt.rail === 'FEDNOW_INSTANT'
                          ? 'FedNow Instant (0s)'
                          : fundSuccessReceipt.rail === 'DEBIT_PULL'
                          ? 'Visa Direct / MC Pull'
                          : 'Direct ACH'}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono">$0.00 Fee Guaranteed</div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Current Bot Margin</div>
                      <div className="text-base font-black text-cyan-400 font-mono mt-0.5">
                        {formatCurrency(botCash)}
                      </div>
                      <div className="text-[10px] text-slate-500">Ready to trade</div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Audit Hash:</span>
                      <span className="text-cyan-400 truncate text-[11px] select-all">
                        {fundSuccessReceipt.referenceHash}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(fundSuccessReceipt.referenceHash)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] shrink-0 ml-2 transition-all cursor-pointer"
                    >
                      {copiedHash === fundSuccessReceipt.referenceHash ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-slate-400" />
                          <span>Copy Hash</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => downloadReceiptText(fundSuccessReceipt)}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-500/30"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download Receipt (.txt)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFundSuccessReceipt(null)}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
                    >
                      Fund More Capital
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-xs transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      <span>Start Bot with New Margin</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Main Fund Bot Configuration Card */}
              <div className="p-6 bg-slate-900/90 border border-amber-500/30 rounded-2xl shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-yellow-500/20 border border-amber-500/40 text-amber-400">
                      <Zap className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-2">
                        <span>Fund Trading Bot from Bank or Check Card</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Direct to Margin
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Transfers credit immediately to Bot Active Margin so automated strategies can execute live and simulated orders.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 self-start sm:self-auto font-mono">
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">Current Bot Margin</div>
                      <div className="text-base sm:text-lg font-black text-emerald-400">
                        {formatCurrency(botCash)}
                      </div>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleFundBotSubmit} className="space-y-6">
                  {/* STEP 1: SELECT TRANSFER SOURCE */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                      1. Select Funding Source
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Option A: Bank Account */}
                      <div
                        onClick={() => setFundBotSourceType('BANK')}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          fundBotSourceType === 'BANK'
                            ? 'bg-amber-950/30 border-amber-500/80 ring-2 ring-amber-500/40 shadow-lg shadow-amber-500/10'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300">
                              <Building2 className="h-4 w-4" />
                            </div>
                            <span className="text-sm font-bold text-white">Bank Account</span>
                          </div>
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                            FedNow 0s
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          US checking or savings account. Real-time FedNow instant settlement or ACH.
                        </div>
                        {fiatAccount.linkedBanks.length > 0 && (
                          <div className="text-[10px] text-cyan-300 font-mono mt-2">
                            {fiatAccount.linkedBanks.length} connected bank{fiatAccount.linkedBanks.length > 1 ? 's' : ''} available
                          </div>
                        )}
                      </div>

                      {/* Option B: Check Card / Debit Card */}
                      <div
                        onClick={() => setFundBotSourceType('CARD')}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          fundBotSourceType === 'CARD'
                            ? 'bg-cyan-950/30 border-cyan-500/80 ring-2 ring-cyan-500/40 shadow-lg shadow-cyan-500/10'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-300">
                              <CreditCard className="h-4 w-4" />
                            </div>
                            <span className="text-sm font-bold text-white">Check / Debit Card</span>
                          </div>
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                            Instant Pull
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Instant card pull via Visa Direct or Mastercard. Funds clear in 0 seconds.
                        </div>
                        {fiatAccount.linkedCards.length > 0 && (
                          <div className="text-[10px] text-cyan-300 font-mono mt-2">
                            {fiatAccount.linkedCards.length} saved check card{fiatAccount.linkedCards.length > 1 ? 's' : ''} ready
                          </div>
                        )}
                      </div>

                      {/* Option C: Live Treasury Vault */}
                      <div
                        onClick={() => setFundBotSourceType('VAULT')}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          fundBotSourceType === 'VAULT'
                            ? 'bg-purple-950/30 border-purple-500/80 ring-2 ring-purple-500/40 shadow-lg shadow-purple-500/10'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300">
                              <Landmark className="h-4 w-4" />
                            </div>
                            <span className="text-sm font-bold text-white">Treasury Vault</span>
                          </div>
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
                            Internal
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          Move existing funds from Live USD Treasury Vault into Bot Trading Margin.
                        </div>
                        <div className="text-[10px] text-emerald-400 font-mono mt-2">
                          {formatCurrency(fiatAccount.availableBalance)} available
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* STEP 2: SOURCE CONFIGURATION */}
                  {/* WHEN SOURCE IS BANK ACCOUNT */}
                  {fundBotSourceType === 'BANK' && (
                    <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-4">
                      {/* Connected Banks List (if any) */}
                      {fiatAccount.linkedBanks.length > 0 && !showNewBankInFund && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-300">Select Connected Bank Account:</span>
                            <button
                              type="button"
                              onClick={() => setShowNewBankInFund(true)}
                              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" />
                              <span>Use Another Bank</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {fiatAccount.linkedBanks.map((bank) => (
                              <div
                                key={bank.id}
                                onClick={() => setSelectedBankId(bank.id)}
                                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                                  selectedBankId === bank.id
                                    ? 'bg-emerald-950/30 border-emerald-500 ring-2 ring-emerald-500/30 shadow-md'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-emerald-400" />
                                    <span className="text-xs font-bold text-white">{bank.bankName}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                      {bank.status}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveBank(bank.id, bank.bankName);
                                      }}
                                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                                      title="Disconnect and remove bank account"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-[11px] text-slate-400 mt-1 font-mono flex items-center justify-between">
                                  <span>{bank.accountType}: {bank.accountNumberMasked}</span>
                                  <span>Routing: {bank.routingNumber}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* New Bank or 1-Click Popular Institution Form */}
                      {(fiatAccount.linkedBanks.length === 0 || showNewBankInFund) && (
                        <div className="space-y-3.5">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                              <Building2 className="h-4 w-4 text-emerald-400" />
                              <span>Select Popular Bank or Enter Custom Routing</span>
                            </div>
                            {fiatAccount.linkedBanks.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowNewBankInFund(false)}
                                className="text-xs text-slate-400 hover:text-white cursor-pointer"
                              >
                                Cancel (Use Existing Bank)
                              </button>
                            )}
                          </div>

                          {/* 1-Click Popular Bank Selector Chips */}
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono mb-1.5">
                              1-Click Popular Financial Institutions:
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {POPULAR_BANKS.slice(0, 8).map((p) => (
                                <button
                                  key={p.name}
                                  type="button"
                                  onClick={() => {
                                    setNewBankName(p.name);
                                    setNewRoutingNumber(p.routing);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-all ${
                                    newBankName === p.name
                                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/50 font-bold'
                                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                                  }`}
                                >
                                  {p.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                Bank or Credit Union Name
                              </label>
                              <input
                                type="text"
                                value={newBankName}
                                onChange={(e) => setNewBankName(e.target.value)}
                                placeholder="e.g. Bank of America, Wells Fargo, Navy Federal"
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-500"
                                required
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="block text-[10px] font-bold text-slate-400 uppercase">
                                  9-Digit ABA Routing #
                                </label>
                                {newRoutingNumber.length === 9 && (
                                  <span className="text-[10px] text-emerald-400 font-mono">Valid 9-Digit ABA</span>
                                )}
                              </div>
                              <input
                                type="text"
                                maxLength={9}
                                value={newRoutingNumber}
                                onChange={(e) => setNewRoutingNumber(e.target.value.replace(/\D/g, ''))}
                                placeholder="e.g. 121000358"
                                className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-500 tracking-wider"
                                required
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="block text-[10px] font-bold text-slate-400 uppercase">
                                  Account Number
                                </label>
                              </div>
                              <input
                                type="text"
                                value={newAccountNumber}
                                onChange={(e) => setNewAccountNumber(e.target.value.replace(/\D/g, ''))}
                                placeholder="e.g. 1092837465"
                                className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-500 tracking-wider"
                                required
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                Account Type
                              </label>
                              <div className="flex items-center gap-3 pt-2 text-xs">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="fundAccType"
                                    checked={newAccountType === 'CHECKING'}
                                    onChange={() => setNewAccountType('CHECKING')}
                                    className="text-amber-500"
                                  />
                                  <span className="text-slate-300">Checking (Commercial / Personal)</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="fundAccType"
                                    checked={newAccountType === 'SAVINGS'}
                                    onChange={() => setNewAccountType('SAVINGS')}
                                    className="text-amber-500"
                                  />
                                  <span className="text-slate-300">Savings</span>
                                </label>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                            <span className="text-[11px] text-slate-400">Want to connect this bank without depositing right now?</span>
                            <button
                              type="button"
                              onClick={(e) => handleLinkBank(e)}
                              disabled={isLoading || !newBankName || newRoutingNumber.length !== 9 || newAccountNumber.length < 4}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 font-bold text-xs cursor-pointer transition-all disabled:opacity-40 flex items-center gap-1.5"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>+ Connect & Save Bank Account</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Rail Speed Selector */}
                      <div className="pt-2 border-t border-slate-800">
                        <label className="block text-xs font-bold text-slate-300 mb-2">
                          Select Banking Clearing Speed
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setTransferSpeed('INSTANT_FEDNOW')}
                            className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                              transferSpeed === 'INSTANT_FEDNOW'
                                ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-bold">
                              <Zap className="h-3.5 w-3.5 text-emerald-400" />
                              <span>FedNow Instant Rail</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              0s Instant clearing (24/7/365, Zero fee)
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setTransferSpeed('STANDARD_ACH')}
                            className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                              transferSpeed === 'STANDARD_ACH'
                                ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-bold">
                              <Landmark className="h-3.5 w-3.5 text-cyan-400" />
                              <span>Standard Direct ACH</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              Automated Clearing House (Zero fee)
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* WHEN SOURCE IS CHECK CARD / DEBIT CARD */}
                  {fundBotSourceType === 'CARD' && (
                    <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-4">
                      {/* Linked Check Cards List (if any) */}
                      {fiatAccount.linkedCards.length > 0 && !showNewCardInFund && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-300">Select Saved Check Card:</span>
                            <button
                              type="button"
                              onClick={() => setShowNewCardInFund(true)}
                              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" />
                              <span>Enter Another Check Card</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {fiatAccount.linkedCards.map((card) => (
                              <div
                                key={card.id}
                                onClick={() => setSelectedCardId(card.id)}
                                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                                  selectedCardId === card.id
                                    ? 'bg-cyan-950/40 border-cyan-500 ring-2 ring-cyan-500/30 shadow-md'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <CreditCard className="h-4 w-4 text-cyan-400" />
                                    <span className="text-xs font-bold text-white">{card.brand} Check Card</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                                      •••• {card.last4}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveCard(card.id, card.brand, card.last4);
                                      }}
                                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                                      title="Disconnect and remove debit card"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-[11px] text-slate-400 mt-1 font-mono flex items-center justify-between">
                                  <span>{card.cardholderName}</span>
                                  <span>Exp: {card.expMonth}/{card.expYear}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* New Check Card Entry Form */}
                      {(fiatAccount.linkedCards.length === 0 || showNewCardInFund) && (
                        <div className="space-y-3.5">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                              <CreditCard className="h-4 w-4 text-cyan-400" />
                              <span>Check Card / Debit Card Details</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {fiatAccount.linkedCards.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowNewCardInFund(false)}
                                  className="text-xs text-slate-400 hover:text-white cursor-pointer ml-1"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                              16-Digit Check Card Number
                            </label>
                            <input
                              type="text"
                              maxLength={19}
                              value={newCardNumber}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '').slice(0, 16);
                                const formatted = val.match(/.{1,4}/g)?.join(' ') || val;
                                setNewCardNumber(formatted);
                              }}
                              placeholder="4532 8901 2345 6789"
                              className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-sm font-bold rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                              required
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                Cardholder Legal Name (Printed on Card)
                              </label>
                              <input
                                type="text"
                                value={newCardHolder}
                                onChange={(e) => setNewCardHolder(e.target.value)}
                                placeholder="Legal name on check card"
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500"
                                required
                              />
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                  Month
                                </label>
                                <select
                                  value={newCardExpMonth}
                                  onChange={(e) => setNewCardExpMonth(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-2 py-2.5 font-mono"
                                >
                                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                  Year
                                </label>
                                <select
                                  value={newCardExpYear}
                                  onChange={(e) => setNewCardExpYear(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-2 py-2.5 font-mono"
                                >
                                  {['2026', '2027', '2028', '2029', '2030', '2031', '2032'].map((yr) => (
                                    <option key={yr} value={yr}>{yr}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                  CVV
                                </label>
                                <input
                                  type="password"
                                  maxLength={4}
                                  value={newCardCvc}
                                  onChange={(e) => setNewCardCvc(e.target.value.replace(/\D/g, ''))}
                                  placeholder="•••"
                                  className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-xs rounded-xl px-2 py-2.5 text-center focus:outline-none focus:border-cyan-500 tracking-widest"
                                  required
                                />
                              </div>
                            </div>
                          </div>

                          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 pt-1">
                            <input
                              type="checkbox"
                              checked={saveNewCard}
                              onChange={(e) => setSaveNewCard(e.target.checked)}
                              className="rounded text-cyan-500"
                            />
                            <span>Save check card to account for fast future funding & instant withdrawals</span>
                          </label>

                          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                            <span className="text-[11px] text-slate-400">Want to link this card without depositing right now?</span>
                            <button
                              type="button"
                              onClick={(e) => handleLinkDebitCardStandalone(e)}
                              disabled={isLoading || newCardNumber.replace(/\D/g, '').length < 15 || newCardCvc.replace(/\D/g, '').length < 3}
                              className="px-3.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-300 font-bold text-xs cursor-pointer transition-all disabled:opacity-40 flex items-center gap-1.5"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>+ Tokenize & Save Debit Card</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* WHEN SOURCE IS TREASURY VAULT */}
                  {fundBotSourceType === 'VAULT' && (
                    <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-bold">Live Vault Balance Available:</span>
                        <span className="font-mono text-base font-black text-emerald-400">
                          {formatCurrency(fiatAccount.availableBalance)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Transfer settled USD from your custodial vault directly into active bot margin. Instant clearing, zero fee.
                      </p>
                      <div className="flex gap-2 pt-1">
                        {[0.25, 0.5, 0.75, 1].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setFundBotAmount(String(Math.floor(fiatAccount.availableBalance * pct)))}
                            className="flex-1 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-purple-500/40 text-slate-300 font-mono text-xs font-bold cursor-pointer transition-all"
                          >
                            {pct === 1 ? 'MAX (100%)' : `${pct * 100}%`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* STEP 3: FUNDING AMOUNT */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        2. Transfer Amount to Bot (USD)
                      </label>
                      <span className="text-xs text-slate-400 font-mono">
                        Min: $0.01 • Zero Fee
                      </span>
                    </div>

                    {/* Quick Amount Chips */}
                    <div className="flex flex-wrap gap-2 mb-2.5">
                      {[100, 250, 500, 1000, 2500, 5000, 10000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setFundBotAmount(String(preset))}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold cursor-pointer transition-all ${
                            fundBotAmount === String(preset)
                              ? 'bg-amber-500/20 border-amber-500 text-amber-200 shadow-sm'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                          }`}
                        >
                          +${preset.toLocaleString()}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <span className="absolute left-4 top-2.5 text-slate-400 font-mono text-xl font-bold">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={fundBotAmount}
                        onChange={(e) => setFundBotAmount(e.target.value)}
                        placeholder="500.00"
                        className="w-full bg-slate-950 border border-slate-700 text-white pl-9 pr-4 py-2.5 rounded-xl font-mono text-2xl font-black focus:outline-none focus:border-amber-500"
                        required
                      />
                    </div>
                  </div>

                  {/* STEP 4: REAL-TIME TRANSFER SUMMARY */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Funding Source:</span>
                      <span className="font-semibold text-slate-200">
                        {fundBotSourceType === 'BANK'
                          ? `${newBankName || 'Connected Bank'} (FedNow Instant)`
                          : fundBotSourceType === 'CARD'
                          ? 'Check / Debit Card (Instant Card Pull)'
                          : 'Live USD Treasury Vault'}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400">
                      <span>Destination Target:</span>
                      <span className="font-semibold text-amber-300">
                        Bot Active Margin (Trading Cash)
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400">
                      <span>Transfer Rail & Settlement:</span>
                      <span className="text-cyan-300 font-semibold font-mono">
                        {fundBotSourceType === 'BANK'
                          ? transferSpeed === 'INSTANT_FEDNOW' ? 'FedNow 0s Instant Settlement' : 'Direct ACH (Same-Day)'
                          : fundBotSourceType === 'CARD'
                          ? 'Visa Direct / Mastercard Send (0s Immediate)'
                          : 'Internal Ledger Bridge'}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400">
                      <span>Network Transfer Fee:</span>
                      <span className="text-emerald-400 font-mono font-bold">$0.00 (Zero Fee Guaranteed)</span>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline">
                      <div>
                        <div className="text-slate-400 text-[11px]">Updated Bot Trading Margin:</div>
                        <div className="text-slate-500 text-[10px]">
                          ${botCash.toFixed(2)} + ${parseFloat(fundBotAmount || '0').toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-black font-mono text-emerald-400">
                          {formatCurrency(botCash + (parseFloat(fundBotAmount || '0') || 0))} USD
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* STEP 5: SUBMIT BUTTON */}
                  <button
                    type="submit"
                    disabled={isLoading || parseFloat(fundBotAmount || '0') <= 0}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-xl shadow-amber-500/20 transition-all disabled:opacity-50 active:scale-[0.99]"
                  >
                    {isLoading ? (
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Clearing Transfer via Financial Rails...</span>
                      </div>
                    ) : (
                      <>
                        <Zap className="h-5 w-5" />
                        <span>
                          Complete Transfer & Fund Bot: ${parseFloat(fundBotAmount || '0').toFixed(2)} USD
                        </span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB: ADD NEW BANK ACCOUNT (DEDICATED FULL-SPACE VIEW) */}
          {activeTab === 'ADD_BANK' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
              <div className="p-6 bg-slate-900/90 border border-cyan-500/30 rounded-2xl shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                      <Landmark className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-wide">
                        Connect Bank Account for Withdrawals & Deposits
                      </h3>
                      <p className="text-xs text-slate-400">
                        Link any US commercial bank, online bank, or credit union. Enabled for direct ACH and FedNow instant settlements.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Zero Transfer Fees
                    </span>
                  </div>
                </div>

                {/* Popular Bank One-Click Selectors */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Select Your Financial Institution (Or enter custom below)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {POPULAR_BANKS.map((p) => {
                      const isSelected = newBankName === p.name;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => {
                            setNewBankName(p.name);
                            setNewRoutingNumber(p.routing);
                          }}
                          className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-500/10'
                              : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Building2 className={`h-4 w-4 ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`} />
                            <div className="font-semibold text-xs truncate">{p.name}</div>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            ABA: {p.routing}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bank Account Details Form */}
                <form onSubmit={handleLinkBank} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Bank / Credit Union Name
                      </label>
                      <input
                        type="text"
                        value={newBankName}
                        onChange={(e) => setNewBankName(e.target.value)}
                        placeholder="e.g. Bank of America, Wells Fargo, Navy Federal"
                        className="w-full bg-slate-950 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Account Holder Legal Name
                      </label>
                      <input
                        type="text"
                        value={newAccountHolder}
                        onChange={(e) => setNewAccountHolder(e.target.value)}
                        placeholder="e.g. John Doe (Account Legal Name)"
                        className="w-full bg-slate-950 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        9-Digit ABA Routing Number
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          maxLength={9}
                          value={newRoutingNumber}
                          onChange={(e) => setNewRoutingNumber(e.target.value.replace(/\D/g, ''))}
                          placeholder="e.g. 121000358"
                          className="w-full bg-slate-950 border border-slate-700 text-white text-sm font-mono rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                          required
                        />
                        {newRoutingNumber.length === 9 && (
                          <span className="absolute right-3 top-3 text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Valid ABA
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-slate-300">
                          Account Number
                        </label>
                      </div>
                      <input
                        type="text"
                        value={newAccountNumber}
                        onChange={(e) => setNewAccountNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g. 1029384756"
                        className="w-full bg-slate-950 border border-slate-700 text-white text-sm font-mono rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                        required
                      />
                    </div>
                  </div>

                  {/* Account Classification */}
                  <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-300">
                      Account Type:
                    </div>
                    <div className="flex items-center gap-6 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="fullAddAccType"
                          checked={newAccountType === 'CHECKING'}
                          onChange={() => setNewAccountType('CHECKING')}
                          className="text-cyan-500 focus:ring-cyan-500"
                        />
                        <span className="text-slate-200 font-medium">Checking Account</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="fullAddAccType"
                          checked={newAccountType === 'SAVINGS'}
                          onChange={() => setNewAccountType('SAVINGS')}
                          className="text-cyan-500 focus:ring-cyan-500"
                        />
                        <span className="text-slate-200 font-medium">Savings Account</span>
                      </label>
                    </div>
                  </div>

                  {/* Security Clearance Callout */}
                  <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800 flex items-start gap-3 text-xs text-slate-400">
                    <Lock className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-slate-300">
                        Nacha Compliant Direct Bank Linking
                      </p>
                      <p className="mt-0.5">
                        Your account credentials and transit numbers are encrypted via 256-bit AES encryption. Connecting an account grants zero-fee deposit and withdrawal privileges with instant verification.
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('WITHDRAW')}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all flex items-center justify-center gap-2"
                    >
                      <ArrowUpFromLine className="h-4 w-4 text-emerald-400" />
                      <span>Back to Withdraw Funds</span>
                    </button>

                    <button
                      type="submit"
                      disabled={isLoading || !newBankName}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/10 transition-all disabled:opacity-50"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                          <span>Verifying with Clearing House...</span>
                        </div>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Verify & Connect Bank Account</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* List of currently connected bank accounts */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Currently Connected Bank Accounts ({fiatAccount.linkedBanks.length})
                </h4>
                {fiatAccount.linkedBanks.length === 0 ? (
                  <div className="p-6 rounded-xl bg-slate-900/40 border border-dashed border-slate-800 text-center">
                    <Building2 className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                    <div className="text-sm font-medium text-slate-300">No Bank Accounts Connected</div>
                    <div className="text-xs text-slate-500 mt-1">Use Plaid or enter routing details above to link your real bank account.</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fiatAccount.linkedBanks.map((bank) => (
                      <div
                        key={bank.id}
                        className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white flex items-center gap-2">
                              <span>{bank.bankName}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                {bank.status}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              {bank.accountType} •••• {bank.accountNumberMasked.slice(-4)} | Routing: {bank.routingNumber}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawBankId(bank.id);
                              setWithdrawDestinationType('BANK');
                              setActiveTab('WITHDRAW');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 border border-slate-700 cursor-pointer transition-all"
                          >
                            Withdraw
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveBank(bank.id, bank.bankName)}
                            className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 cursor-pointer transition-all"
                            title="Disconnect and purge bank credentials"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: ADD NEW DEBIT CARD (DEDICATED FULL-SPACE VIEW) */}
          {activeTab === 'ADD_CARD' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
              <div className="p-6 bg-slate-900/90 border border-cyan-500/30 rounded-2xl shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                      <CreditCard className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-wide">
                        Link Debit Card for Instant Push Withdrawals
                      </h3>
                      <p className="text-xs text-slate-400">
                        Powered by Visa Direct & Mastercard Send. Funds reflect in your bank account in under 30 minutes.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                      <Zap className="h-3.5 w-3.5" />
                      Instant 30-Min Push
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Visual Card Preview with Interactive Flip */}
                  <div className="md:col-span-5 flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-400">Interactive Card Preview</span>
                      <button
                        type="button"
                        onClick={() => setIsCardFlipped(!isCardFlipped)}
                        className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
                      >
                        <RotateCw className="h-3 w-3" />
                        <span>Flip {isCardFlipped ? 'to Front' : 'to Back (CVV)'}</span>
                      </button>
                    </div>

                    {!isCardFlipped ? (
                      /* Card Front */
                      <div
                        onClick={() => setIsCardFlipped(true)}
                        className="relative h-52 w-full rounded-2xl p-5 bg-gradient-to-tr from-slate-900 via-slate-800 to-cyan-950 border border-cyan-500/40 shadow-2xl flex flex-col justify-between overflow-hidden cursor-pointer transition-transform hover:scale-[1.01]"
                        title="Click to flip card to back"
                      >
                        <div className="absolute top-0 right-0 w-36 h-36 bg-cyan-500/15 rounded-full blur-2xl pointer-events-none" />
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-10 bg-amber-400/20 border border-amber-400/40 rounded flex items-center justify-center">
                              <div className="w-5 h-4 border border-amber-400/60 rounded-sm" />
                            </div>
                            <span className="text-[10px] font-mono text-cyan-300 font-semibold tracking-wider">
                              DEBIT RAIL
                            </span>
                          </div>
                          <span className="text-sm font-bold font-mono tracking-widest text-white">
                            {newCardNumber.startsWith('4') ? 'VISA' : newCardNumber.startsWith('5') ? 'MASTERCARD' : 'VISA / MC'}
                          </span>
                        </div>

                        <div className="my-auto">
                          <div className="font-mono text-lg tracking-[0.2em] text-white font-bold drop-shadow">
                            {newCardNumber ? newCardNumber.padEnd(19, '•') : '•••• •••• •••• ••••'}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs font-mono">
                          <div>
                            <div className="text-[8px] uppercase tracking-wider text-slate-400">Cardholder</div>
                            <div className="text-slate-200 font-semibold truncate max-w-[150px]">
                              {newCardHolder || 'PRIMARY TRADER'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[8px] uppercase tracking-wider text-slate-400">Expires</div>
                            <div className="text-slate-200 font-semibold">
                              {newCardExpMonth}/{newCardExpYear.slice(-2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Card Back */
                      <div
                        onClick={() => setIsCardFlipped(false)}
                        className="relative h-52 w-full rounded-2xl bg-gradient-to-tr from-slate-950 via-slate-900 to-slate-800 border border-cyan-500/40 shadow-2xl flex flex-col justify-between overflow-hidden cursor-pointer transition-transform hover:scale-[1.01]"
                        title="Click to flip card to front"
                      >
                        <div className="h-10 w-full bg-slate-950 mt-4 border-y border-slate-800" />
                        <div className="px-5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] uppercase font-mono text-slate-400">Authorized Signature</span>
                            <span className="text-[8px] uppercase font-mono text-slate-400">CVV/CVC</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-8 bg-slate-100/90 rounded px-3 flex items-center font-serif italic text-slate-800 text-xs select-none">
                              {newCardHolder || 'Authorized Trader'}
                            </div>
                            <div className="h-8 w-14 bg-slate-900 border border-slate-700 rounded flex items-center justify-center font-mono font-bold text-amber-300 text-sm">
                              {newCardCvc || '•••'}
                            </div>
                          </div>
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-between text-[8px] font-mono text-slate-500">
                          <span>Custodial Card Services • 1-800-APEX-USD</span>
                          <span className="text-cyan-400 font-bold">PCI-DSS TIER 1</span>
                        </div>
                      </div>
                    )}

                    <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 text-xs space-y-2 text-slate-400">
                      <div className="flex items-center gap-2 text-slate-300 font-semibold">
                        <Lock className="h-3.5 w-3.5 text-cyan-400" />
                        <span>PCI-DSS Tier 1 Encrypted Vault</span>
                      </div>
                      <p>
                        Cards are tokenized and stored securely. You can withdraw directly to this card anytime with instant confirmation.
                      </p>
                    </div>
                  </div>

                  {/* Card Entry Form */}
                  <div className="md:col-span-7">
                    <form onSubmit={handleLinkDebitCardStandalone} className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-slate-300">
                            16-Digit Debit Card Number
                          </label>
                        </div>
                        <input
                          type="text"
                          maxLength={19}
                          value={newCardNumber}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 16);
                            const formatted = val.match(/.{1,4}/g)?.join(' ') || val;
                            setNewCardNumber(formatted);
                          }}
                          placeholder="4532 8901 2345 6789"
                          className="w-full bg-slate-950 border border-slate-700 text-white font-mono text-base font-bold rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Cardholder Legal Name (as on card)
                        </label>
                        <input
                          type="text"
                          value={newCardHolder}
                          onChange={(e) => setNewCardHolder(e.target.value)}
                          placeholder="e.g. John Doe (Cardholder Legal Name)"
                          className="w-full bg-slate-950 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Exp. Month
                          </label>
                          <select
                            value={newCardExpMonth}
                            onChange={(e) => setNewCardExpMonth(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500 font-mono"
                          >
                            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Exp. Year
                          </label>
                          <select
                            value={newCardExpYear}
                            onChange={(e) => setNewCardExpYear(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500 font-mono"
                          >
                            {['2026', '2027', '2028', '2029', '2030', '2031', '2032'].map((yr) => (
                              <option key={yr} value={yr}>
                                {yr}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            CVV / CVC
                          </label>
                          <input
                            type="password"
                            maxLength={4}
                            value={newCardCvc}
                            onChange={(e) => setNewCardCvc(e.target.value.replace(/\D/g, ''))}
                            placeholder="•••"
                            className="w-full bg-slate-950 border border-slate-700 text-white text-sm font-mono rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500 tracking-widest text-center"
                            required
                          />
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab('WITHDRAW')}
                          className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all flex items-center justify-center gap-2"
                        >
                          <ArrowUpFromLine className="h-4 w-4 text-emerald-400" />
                          <span>Back to Withdraw Funds</span>
                        </button>

                        <button
                          type="submit"
                          disabled={isLoading || newCardNumber.replace(/\s/g, '').length < 15 || !newCardHolder}
                          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/10 transition-all disabled:opacity-50"
                        >
                          {isLoading ? (
                            <div className="flex items-center gap-2">
                              <div className="h-4 w-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                              <span>Tokenizing Card...</span>
                            </div>
                          ) : (
                            <>
                              <ShieldCheck className="h-4 w-4" />
                              <span>Save & Link Debit Card</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>

              {/* List of currently linked debit cards */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Currently Linked Debit Cards ({fiatAccount.linkedCards.length})
                </h4>
                {fiatAccount.linkedCards.length === 0 ? (
                  <div className="p-6 rounded-xl bg-slate-900/40 border border-dashed border-slate-800 text-center">
                    <CreditCard className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                    <div className="text-sm font-medium text-slate-300">No Debit Cards Linked</div>
                    <div className="text-xs text-slate-500 mt-1">Use the card entry form above to link a card for instant deposits and payouts.</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fiatAccount.linkedCards.map((card) => (
                      <div
                        key={card.id}
                        className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                            <CreditCard className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white flex items-center gap-2">
                              <span>{card.brand} •••• {card.last4}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                Instant Push
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              {card.cardholderName} | Exp: {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setWithdrawCardId(card.id);
                              setWithdrawDestinationType('CARD');
                              setActiveTab('WITHDRAW');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 border border-slate-700 cursor-pointer transition-all"
                          >
                            Withdraw
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveCard(card.id, card.brand, card.last4)}
                            className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 cursor-pointer transition-all"
                            title="Disconnect and remove debit card"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* UNIFIED DEPOSIT HEADER & RAIL SELECTOR */}
          {(activeTab === 'DEPOSIT' || activeTab === 'DEBIT_CARD' || activeTab === 'BANK_TRANSFER') && (
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-4 mb-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ArrowDownToLine className="h-4 w-4 text-emerald-400" />
                    <span>Deposit Funds to Trading Account</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Transfer USD from connected banks via FedNow instant (0s), standard ACH, or instant debit card pull.
                  </p>
                </div>

                {/* Rail Selector */}
                <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('DEPOSIT');
                      setDepositMethod('BANK');
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      depositMethod === 'BANK'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Connected Bank (FedNow / ACH)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('DEPOSIT');
                      setDepositMethod('CARD');
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      depositMethod === 'CARD'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Debit Card (Instant)</span>
                  </button>
                </div>
              </div>

              {/* Destination Target: Direct to Bot vs Live Vault */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                <div>
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span>Deposit Destination Target:</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {depositTarget === 'BOT'
                      ? '⚡ Funds directly increase Bot Active Margin (Portfolio Cash) so the bot trades immediately.'
                      : '🏛 Funds are safely stored in your Live USD Treasury Vault. Transfer to bot anytime in Bot Margin Transfer.'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDepositTarget('BOT')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
                      depositTarget === 'BOT'
                        ? 'bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-400/40 font-extrabold'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>Direct to Bot Trading Cash</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositTarget('VAULT')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
                      depositTarget === 'VAULT'
                        ? 'bg-cyan-500 text-slate-950 shadow-md ring-2 ring-cyan-400/40 font-extrabold'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Landmark className="h-3.5 w-3.5" />
                    <span>Live Vault Treasury</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: DEBIT CARD LOADING */}
          {((activeTab === 'DEPOSIT' && depositMethod === 'CARD') || activeTab === 'DEBIT_CARD') && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Left Column: Visual Debit Card */}
              <div className="md:col-span-5 flex flex-col justify-between space-y-4">
                <div className="relative h-48 w-full rounded-2xl p-5 bg-gradient-to-tr from-slate-900 via-slate-800 to-cyan-950 border border-cyan-500/30 shadow-xl flex flex-col justify-between overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-10 bg-amber-400/20 border border-amber-400/40 rounded flex items-center justify-center">
                        <div className="w-5 h-4 border border-amber-400/60 rounded-sm" />
                      </div>
                      <span className="text-[10px] font-mono text-cyan-300 font-semibold tracking-wider">DEBIT RAIL</span>
                    </div>
                    <span className="text-sm font-bold font-mono tracking-widest text-white">
                      {selectedCardId === 'NEW' ? 'VISA / MC' : activeCard?.brand || 'VISA'}
                    </span>
                  </div>

                  <div className="my-auto">
                    <div className="font-mono text-base tracking-[0.2em] text-white font-bold">
                      {selectedCardId === 'NEW'
                        ? newCardNumber
                          ? newCardNumber.padEnd(19, '•')
                          : '•••• •••• •••• ••••'
                        : `•••• •••• •••• ${activeCard?.last4 || '4242'}`}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <div>
                      <div className="text-[8px] uppercase tracking-wider text-slate-400">Cardholder</div>
                      <div className="text-slate-200 font-semibold truncate max-w-[140px]">
                        {selectedCardId === 'NEW' ? newCardHolder || 'CARDHOLDER' : activeCard?.cardholderName}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] uppercase tracking-wider text-slate-400">Expires</div>
                      <div className="text-slate-200 font-semibold">
                        {selectedCardId === 'NEW'
                          ? `${newCardExpMonth}/${newCardExpYear.slice(-2)}`
                          : `${String(activeCard?.expMonth || 12).padStart(2, '0')}/${String(
                              activeCard?.expYear || 2029
                            ).slice(-2)}`}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] space-y-2 text-slate-400">
                  <div className="flex items-center gap-2 text-slate-300 font-semibold">
                    <Lock className="h-3.5 w-3.5 text-cyan-400" />
                    <span>PCI-DSS Tier 1 Encrypted Tokenization</span>
                  </div>
                  <p>
                    Card numbers are tokenized immediately into an AES-256 cryptographic vault. Funds are credited instantly with 0% gateway fee.
                  </p>
                </div>
              </div>

              {/* Right Column: Loading Controls */}
              <div className="md:col-span-7">
                <form onSubmit={handleDebitCardDeposit} className="space-y-4">
                  {/* Card Selector */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Select Payment Card
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {fiatAccount.linkedCards.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => setSelectedCardId(card.id)}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            selectedCardId === card.id
                              ? 'bg-cyan-500/10 border-cyan-500/50 text-white'
                              : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold font-mono">
                              {card.brand} (•••• {card.last4})
                            </span>
                            {card.isDefault && (
                              <span className="text-[9px] bg-slate-800 text-cyan-300 px-1.5 py-0.5 rounded">Default</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            Exp: {card.expMonth}/{card.expYear} • Instant Load
                          </div>
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => setSelectedCardId('NEW')}
                        className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex items-center gap-2 ${
                          selectedCardId === 'NEW'
                            ? 'bg-cyan-500/10 border-cyan-500/50 text-white'
                            : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <Plus className="h-4 w-4 text-cyan-400" />
                        <div>
                          <div className="text-xs font-bold">Use New Card</div>
                          <div className="text-[10px] text-slate-400">Load with any Visa/MC</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* New Card Fields (Conditional) */}
                  {selectedCardId === 'NEW' && (
                    <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                      <div className="text-xs font-bold text-slate-200">New Debit Card Details</div>

                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">Card Number (16 Digits)</label>
                        <input
                          type="text"
                          maxLength={19}
                          placeholder="4532 •••• •••• 8821"
                          value={newCardNumber}
                          onChange={(e) => setNewCardNumber(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">Exp Month</label>
                          <select
                            value={newCardExpMonth}
                            onChange={(e) => setNewCardExpMonth(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-cyan-500"
                          >
                            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">Exp Year</label>
                          <select
                            value={newCardExpYear}
                            onChange={(e) => setNewCardExpYear(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-cyan-500"
                          >
                            {['2025', '2026', '2027', '2028', '2029', '2030', '2031', '2032'].map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">CVV / CVC</label>
                          <input
                            type="password"
                            maxLength={4}
                            placeholder="•••"
                            value={newCardCvc}
                            onChange={(e) => setNewCardCvc(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <label className="text-[11px] text-slate-300 flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saveNewCard}
                            onChange={(e) => setSaveNewCard(e.target.checked)}
                            className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                          />
                          <span>Save card token for 1-click loading</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Load Amount Preset Chips */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        Load Amount (USD)
                      </label>
                      <span className="text-[10px] text-cyan-400 font-mono">Min $0.01</span>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 mb-2">
                      {['0.01', '1', '5', '10', '25', '100', '500', '1000'].map((amt) => (
                        <button
                          key={`card-amt-preset-${amt}`}
                          type="button"
                          onClick={() => setCardDepositAmount(amt)}
                          className={`py-1 rounded-lg border text-[11px] font-mono font-bold cursor-pointer transition-all ${
                            cardDepositAmount === amt
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                              : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          +${amt}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-sm">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={cardDepositAmount}
                        onChange={(e) => setCardDepositAmount(e.target.value)}
                        placeholder="0.01"
                        className="w-full bg-slate-900 border border-slate-700 text-white pl-8 pr-4 py-2.5 rounded-xl font-mono text-base font-bold focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/10 transition-all"
                  >
                    {isLoading ? (
                      <div className="flex items-center gap-2">
                        <div className="h-3.5 w-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                        <span>Authorizing 3D Secure Rail...</span>
                      </div>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        <span>Instant Load ${parseFloat(cardDepositAmount || '0').toFixed(2)} USD</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: CONNECT & DEPOSIT ANY BANK */}
          {((activeTab === 'DEPOSIT' && depositMethod === 'BANK') || activeTab === 'BANK_TRANSFER') && (
            <div className="space-y-6">
              {/* Linked Banks Cards */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300">Connected Bank Accounts</span>
                  <button
                    onClick={() => setShowConnectBankForm(!showConnectBankForm)}
                    className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{showConnectBankForm ? 'Hide Link Form' : 'Connect Any New Bank Account'}</span>
                  </button>
                </div>

                {fiatAccount.linkedBanks.length === 0 ? (
                  <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-center space-y-2">
                    <Building2 className="h-6 w-6 text-cyan-400 mx-auto" />
                    <div className="text-xs font-bold text-white">No Bank Account Connected Yet</div>
                    <div className="text-[11px] text-slate-400">
                      Click below to connect your checking account via Plaid or manual ABA routing to deposit funds.
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConnectBankForm(true)}
                      className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Connect Bank Account</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fiatAccount.linkedBanks.map((bank) => (
                    <div
                      key={bank.id}
                      onClick={() => setSelectedBankId(bank.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                        selectedBankId === bank.id
                          ? 'bg-cyan-500/10 border-cyan-500/60 ring-1 ring-cyan-500/30'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-cyan-400" />
                          <span className="text-xs font-bold text-white">{bank.bankName}</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {bank.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-2 font-mono flex items-center justify-between">
                        <span>
                          {bank.accountType}: {bank.accountNumberMasked}
                        </span>
                        <span>Routing: {bank.routingNumber}</span>
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>

              {/* Connect Bank Form (Plaid or Direct ACH) */}
              {showConnectBankForm && (
                <form
                  onSubmit={handleLinkBank}
                  className="p-4 bg-slate-950/70 border border-cyan-500/30 rounded-2xl space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-cyan-400" />
                      <span className="text-xs font-bold text-white">Connect Any Bank (US & International)</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Direct ACH & Open Banking Rails</span>
                  </div>

                  {/* Popular Bank Presets */}
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1.5">Select Popular Institution (or type custom)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {POPULAR_BANKS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => {
                            setNewBankName(p.name);
                            setNewRoutingNumber(p.routing);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-all ${
                            newBankName === p.name
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Bank Name</label>
                      <input
                        type="text"
                        value={newBankName}
                        onChange={(e) => setNewBankName(e.target.value)}
                        placeholder="e.g. Bank of America, Wells Fargo, Credit Union"
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Account Holder Name</label>
                      <input
                        type="text"
                        value={newAccountHolder}
                        onChange={(e) => setNewAccountHolder(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">9-Digit ABA Routing Number</label>
                      <input
                        type="text"
                        maxLength={9}
                        value={newRoutingNumber}
                        onChange={(e) => setNewRoutingNumber(e.target.value)}
                        placeholder="e.g. 121000358"
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] text-slate-400">Account Number</label>
                      </div>
                      <input
                        type="text"
                        value={newAccountNumber}
                        onChange={(e) => setNewAccountNumber(e.target.value)}
                        placeholder="•••• •••• 9812"
                        className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-3 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="accType"
                          checked={newAccountType === 'CHECKING'}
                          onChange={() => setNewAccountType('CHECKING')}
                          className="text-cyan-500"
                        />
                        <span className="text-slate-300">Checking</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="accType"
                          checked={newAccountType === 'SAVINGS'}
                          onChange={() => setNewAccountType('SAVINGS')}
                          className="text-cyan-500"
                        />
                        <span className="text-slate-300">Savings</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl cursor-pointer transition-all flex items-center gap-2"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>Verify & Connect Bank Account</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Deposit from Selected Bank */}
              <form onSubmit={handleBankDeposit} className="p-4 bg-slate-950/50 border border-slate-800 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Deposit to Trading Account from Bank</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">Settlement Rail:</span>
                    <button
                      type="button"
                      onClick={() => setTransferSpeed('INSTANT_FEDNOW')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                        transferSpeed === 'INSTANT_FEDNOW'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      FedNow Instant (0s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransferSpeed('STANDARD_ACH')}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                        transferSpeed === 'STANDARD_ACH'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      Standard ACH
                    </button>
                  </div>
                </div>

                {/* Amount presets */}
                <div className="flex flex-wrap gap-2">
                  {['0.01', '1', '5', '10', '25', '100', '250', '500', '1000', '5000'].map((chip) => (
                    <button
                      key={`bank-chip-preset-${chip}`}
                      type="button"
                      onClick={() => setBankDepositAmount(chip)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-mono font-bold cursor-pointer transition-all ${
                        bankDepositAmount === chip
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      +${chip}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-slate-400">Deposit Amount (USD)</label>
                      <span className="text-[10px] text-emerald-400 font-mono">Min $0.01</span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-sm">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0.01"
                        value={bankDepositAmount}
                        onChange={(e) => setBankDepositAmount(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-white pl-8 pr-4 py-2.5 rounded-xl font-mono text-base font-bold focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={isLoading || !selectedBankId}
                      className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10"
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                      <span>
                        {isLoading
                          ? 'Clearing FedNow Transfer...'
                          : `Execute Bank Deposit ($${parseFloat(bankDepositAmount || '0').toFixed(2)}) ➔ ${
                              depositTarget === 'BOT' ? 'Bot Trading Cash' : 'Live Vault'
                            }`}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: WITHDRAW FUNDS (MULTI-RAIL: BANK ACH/FEDNOW/WIRE & DEBIT CARD PUSH) */}
          {activeTab === 'WITHDRAW' && (
            <div className="space-y-5">
              {/* Receipt Banner if a withdrawal just succeeded */}
              {withdrawSuccessReceipt && (
                <div className="p-4 bg-gradient-to-br from-emerald-950/60 via-slate-900 to-slate-950 border border-emerald-500/50 rounded-2xl shadow-xl space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          Withdrawal Dispatched Successfully
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            SETTLED
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Funds have been deducted from your account and transmitted via the selected clearing network.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setWithdrawSuccessReceipt(null)}
                      className="text-slate-400 hover:text-white p-1 rounded-lg text-xs"
                      title="Dismiss receipt"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Amount Paid Out</div>
                      <div className="text-base font-black text-rose-400 font-mono mt-0.5">
                        -{formatCurrency(withdrawSuccessReceipt.amount)}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Destination</div>
                      <div className="text-xs font-bold text-white truncate mt-0.5">
                        {withdrawSuccessReceipt.destinationName || 'Linked Account'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {withdrawSuccessReceipt.destinationName.includes('••••') ? withdrawSuccessReceipt.destinationName : 'Account Verified'}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Clearing Rail</div>
                      <div className="text-xs font-bold text-cyan-300 mt-0.5">
                        {withdrawSuccessReceipt.rail === 'FEDNOW_WITHDRAWAL' || withdrawSuccessReceipt.rail === 'FEDNOW_INSTANT'
                          ? 'FedNow Instant'
                          : withdrawSuccessReceipt.rail === 'VISA_DIRECT_PUSH'
                          ? 'Visa Direct Push'
                          : withdrawSuccessReceipt.rail === 'WIRE_TRANSFER'
                          ? 'Same-Day Wire'
                          : 'Direct ACH'}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono">Zero Payout Fee</div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                      <div className="text-[10px] text-slate-400 font-mono uppercase">Settled Time</div>
                      <div className="text-xs font-mono text-slate-200 mt-0.5">
                        {new Date(withdrawSuccessReceipt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(withdrawSuccessReceipt.timestamp).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Reference Hash */}
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Audit Hash:</span>
                      <span className="text-cyan-400 truncate text-[11px] select-all">
                        {withdrawSuccessReceipt.referenceHash}
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(withdrawSuccessReceipt.referenceHash)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] shrink-0 ml-2 transition-all cursor-pointer"
                    >
                      {copiedHash === withdrawSuccessReceipt.referenceHash ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-slate-400" />
                          <span>Copy Hash</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => downloadReceiptText(withdrawSuccessReceipt)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-500/30"
                      title="Download cryptographic settlement certificate"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download Receipt (.txt)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('LEDGER')}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Receipt className="h-3.5 w-3.5 text-cyan-400" />
                      <span>View in Audit Ledger</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWithdrawSuccessReceipt(null)}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold transition-all cursor-pointer"
                    >
                      Make Another Withdrawal
                    </button>
                  </div>
                </div>
              )}

              {/* Main Withdrawal Configuration Box */}
              <div className="p-5 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <ArrowUpFromLine className="h-4 w-4 text-rose-400" />
                      Withdraw Capital to External Bank or Debit Card
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Fast, fee-free capital extraction using real-time FedNow, ACH clearing, Wire, or Visa Direct debit push.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3 text-emerald-400" />
                      $0.00 Fee Guaranteed
                    </span>
                  </div>
                </div>

                <form onSubmit={handleWithdrawal} className="space-y-5">
                  {/* STEP 1: CAPITAL SOURCE SELECTOR */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-2">
                      1. Select Capital Source to Withdraw From
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Source A: Live USD Treasury Vault */}
                      <div
                        onClick={() => setWithdrawSource('TREASURY')}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          withdrawSource === 'TREASURY'
                            ? 'bg-emerald-950/30 border-emerald-500/60 ring-1 ring-emerald-500/30'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`p-2 rounded-lg ${withdrawSource === 'TREASURY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                              <Landmark className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">Live Currency Vault</div>
                              <div className="text-[10px] text-slate-400">FDIC-Backed Treasury</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-black font-mono text-emerald-400">
                              {formatCurrency(fiatAccount.availableBalance)}
                            </div>
                            <div className="text-[9px] font-mono text-slate-500">Available</div>
                          </div>
                        </div>
                      </div>

                      {/* Source B: Trading Bot Active Margin Cash */}
                      <div
                        onClick={() => setWithdrawSource('BOT')}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          withdrawSource === 'BOT'
                            ? 'bg-cyan-950/30 border-cyan-500/60 ring-1 ring-cyan-500/30'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`p-2 rounded-lg ${withdrawSource === 'BOT' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400'}`}>
                              <Zap className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">Trading Bot Cash</div>
                              <div className="text-[10px] text-slate-400">Bot Portfolio Margin</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-black font-mono text-cyan-400">
                              {formatCurrency(botCash)}
                            </div>
                            <div className="text-[9px] font-mono text-slate-500">Available</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* STEP 2: DESTINATION METHOD SELECTION */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-300">
                        2. Select Payout Destination
                      </label>
                      <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
                        <button
                          type="button"
                          onClick={() => setWithdrawDestinationType('BANK')}
                          className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            withdrawDestinationType === 'BANK'
                              ? 'bg-emerald-500 text-slate-950 shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <Landmark className="h-3.5 w-3.5" />
                          <span>Bank Account</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWithdrawDestinationType('CARD')}
                          className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            withdrawDestinationType === 'CARD'
                              ? 'bg-cyan-500 text-slate-950 shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          <span>Debit Card (Instant)</span>
                        </button>
                      </div>
                    </div>

                    {/* WHEN DESTINATION IS BANK */}
                    {withdrawDestinationType === 'BANK' && (
                      <div className="space-y-4 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
                        {!showInlineNewBank ? (
                          <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                              <div>
                                <span className="text-xs font-bold text-white flex items-center gap-2">
                                  <Landmark className="h-4 w-4 text-emerald-400" />
                                  Choose Verified Payout Bank
                                </span>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Select a connected account or link a new checking/savings account below.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('ADD_BANK')}
                                  className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  <span>Open Add Bank Tab</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowInlineNewBank(true)}
                                  className="text-xs text-cyan-400 hover:text-cyan-300 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                                >
                                  <span>Quick Form</span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {/* Linked Banks Cards */}
                              {fiatAccount.linkedBanks.map((bank) => (
                                <div
                                  key={bank.id}
                                  onClick={() => setWithdrawBankId(bank.id)}
                                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                                    withdrawBankId === bank.id
                                      ? 'bg-emerald-950/40 border-emerald-500/80 ring-2 ring-emerald-500/40 shadow-lg'
                                      : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                      <div className={`p-2 rounded-lg ${withdrawBankId === bank.id ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                                        <Landmark className="h-4 w-4" />
                                      </div>
                                      <div>
                                        <span className="text-xs font-bold text-white block">{bank.bankName}</span>
                                        <span className="text-[10px] text-slate-400 font-mono">{bank.accountType}</span>
                                      </div>
                                    </div>
                                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                                      Verified
                                    </span>
                                  </div>
                                  <div className="text-xs font-mono text-slate-300 mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
                                    <span className="text-slate-500 text-[10px] uppercase tracking-wider">Account</span>
                                    <span className="font-bold text-white">{bank.accountNumberMasked}</span>
                                  </div>
                                </div>
                              ))}

                              {/* Prominent Action Card: Add New Bank Account */}
                              <div
                                onClick={() => setActiveTab('ADD_BANK')}
                                className="p-4 rounded-xl border-2 border-dashed border-emerald-500/40 bg-emerald-950/10 hover:bg-emerald-950/20 hover:border-emerald-500/70 cursor-pointer transition-all flex flex-col items-center justify-center text-center gap-2 min-h-[110px] group"
                              >
                                <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                                  <Plus className="h-5 w-5" />
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-emerald-300">+ Link New Bank Account</div>
                                  <div className="text-[10px] text-slate-400">Connect any US institution (FedNow & ACH)</div>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          /* Inline New Bank Payout Entry with Spacious Fields & Action Buttons */
                          <div className="space-y-4 bg-slate-950/80 p-5 rounded-2xl border border-cyan-500/40 shadow-xl">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                              <div>
                                <span className="text-sm font-bold text-white flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-cyan-400" />
                                  Enter New Payout Bank Routing Details
                                </span>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Provide the ABA routing number and account number to add this bank for withdrawals.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('ADD_BANK')}
                                  className="text-xs text-cyan-400 hover:text-cyan-300 font-bold"
                                >
                                  Use Full Page Form →
                                </button>
                                {fiatAccount.linkedBanks.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setShowInlineNewBank(false)}
                                    className="text-xs text-slate-400 hover:text-white bg-slate-800 px-2.5 py-1 rounded-lg"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Preset Quick Banks */}
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono mb-1.5">
                                Quick Autofill Popular Institutions:
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {POPULAR_BANKS.slice(0, 6).map((b) => (
                                  <button
                                    key={b.name}
                                    type="button"
                                    onClick={() => {
                                      setInlineBankName(b.name);
                                      setInlineRouting(b.routing);
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 transition-all font-medium flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Building2 className="h-3 w-3 text-cyan-400" />
                                    <span>{b.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                              <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Bank or Credit Union Name</label>
                                <input
                                  type="text"
                                  value={inlineBankName}
                                  onChange={(e) => setInlineBankName(e.target.value)}
                                  placeholder="e.g. Bank of America, Wells Fargo, Navy Federal"
                                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">9-Digit ABA Routing Number</label>
                                <input
                                  type="text"
                                  maxLength={9}
                                  value={inlineRouting}
                                  onChange={(e) => setInlineRouting(e.target.value.replace(/\D/g, ''))}
                                  placeholder="e.g. 121000358"
                                  className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <label className="block text-xs font-semibold text-slate-300">Account Number</label>
                                </div>
                                <input
                                  type="text"
                                  value={inlineAccountNum}
                                  onChange={(e) => setInlineAccountNum(e.target.value.replace(/\D/g, ''))}
                                  placeholder="e.g. 1029384756"
                                  className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Account Type</label>
                                <select
                                  value={inlineAccountType}
                                  onChange={(e) => setInlineAccountType(e.target.value as 'CHECKING' | 'SAVINGS')}
                                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500"
                                >
                                  <option value="CHECKING">Personal / Business Checking</option>
                                  <option value="SAVINGS">High Yield Savings Account</option>
                                </select>
                              </div>
                            </div>

                            {/* Save and Select Button */}
                            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                              {fiatAccount.linkedBanks.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowInlineNewBank(false)}
                                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={handleSaveInlineBank}
                                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                              >
                                {isLoading ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                <span>Save Bank & Select for Withdrawal</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Settlement Rail Picker */}
                        <div className="pt-3 border-t border-slate-800">
                          <label className="block text-xs font-bold text-slate-300 mb-2">
                            Select Settlement Speed & Rail
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                            <button
                              type="button"
                              onClick={() => setWithdrawRail('INSTANT_FEDNOW')}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                withdrawRail === 'INSTANT_FEDNOW'
                                  ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30 shadow-md'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-bold">
                                <Zap className="h-4 w-4 text-emerald-400" />
                                <span>FedNow Instant</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                0s Immediate clearing (24/7/365, Zero fee)
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => setWithdrawRail('ACH_TRANSFER')}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                withdrawRail === 'ACH_TRANSFER'
                                  ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30 shadow-md'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-bold">
                                <Landmark className="h-4 w-4 text-cyan-400" />
                                <span>Direct ACH</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                Free, Next Banking Morning clearing
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => setWithdrawRail('SAME_DAY_WIRE')}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                withdrawRail === 'SAME_DAY_WIRE'
                                  ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30 shadow-md'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-bold">
                                <Building2 className="h-4 w-4 text-amber-400" />
                                <span>Same-Day Wire</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                High-value same-day Fedwire network
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* WHEN DESTINATION IS DEBIT CARD */}
                    {withdrawDestinationType === 'CARD' && (
                      <div className="space-y-4 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
                        {!showInlineNewCard ? (
                          <>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                              <div>
                                <span className="text-xs font-bold text-white flex items-center gap-2">
                                  <CreditCard className="h-4 w-4 text-cyan-400" />
                                  Select Verified Debit Card for Direct Push Payout
                                </span>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Funds push directly to your card-linked checking balance via Visa Direct or Mastercard Send.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('ADD_CARD')}
                                  className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  <span>Open Add Card Tab</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowInlineNewCard(true)}
                                  className="text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                                >
                                  <span>Quick Form</span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {/* Linked Cards List */}
                              {fiatAccount.linkedCards.map((card) => (
                                <div
                                  key={card.id}
                                  onClick={() => setWithdrawCardId(card.id)}
                                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                                    withdrawCardId === card.id
                                      ? 'bg-cyan-950/40 border-cyan-500/80 ring-2 ring-cyan-500/40 shadow-lg'
                                      : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                      <div className={`p-2 rounded-lg ${withdrawCardId === card.id ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'}`}>
                                        <CreditCard className="h-4 w-4" />
                                      </div>
                                      <div>
                                        <span className="text-xs font-bold text-white block">{card.brand} Debit</span>
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          Exp {card.expMonth}/{String(card.expYear).slice(-2)}
                                        </span>
                                      </div>
                                    </div>
                                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                                      Push Ready
                                    </span>
                                  </div>
                                  <div className="text-xs font-mono text-slate-300 mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
                                    <span className="text-slate-500 text-[10px] uppercase tracking-wider">Card Number</span>
                                    <span className="font-bold text-white">•••• {card.last4}</span>
                                  </div>
                                </div>
                              ))}

                              {/* Prominent Action Card: Add New Debit Card */}
                              <div
                                onClick={() => setActiveTab('ADD_CARD')}
                                className="p-4 rounded-xl border-2 border-dashed border-cyan-500/40 bg-cyan-950/10 hover:bg-cyan-950/20 hover:border-cyan-500/70 cursor-pointer transition-all flex flex-col items-center justify-center text-center gap-2 min-h-[110px] group"
                              >
                                <div className="p-2 rounded-full bg-cyan-500/20 text-cyan-400 group-hover:scale-110 transition-transform">
                                  <Plus className="h-5 w-5" />
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-cyan-300">+ Link New Debit Card</div>
                                  <div className="text-[10px] text-slate-400">Instant push payout in under 30 minutes</div>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          /* Inline New Debit Card Entry */
                          <div className="space-y-4 bg-slate-950/80 p-5 rounded-2xl border border-cyan-500/40 shadow-xl">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                              <div>
                                <span className="text-sm font-bold text-white flex items-center gap-2">
                                  <CreditCard className="h-4 w-4 text-cyan-400" />
                                  Enter Debit Card for Instant Push Payout
                                </span>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Supports any Visa or Mastercard debit card. Funds arrive in under 30 minutes.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('ADD_CARD')}
                                  className="text-xs text-cyan-400 hover:text-cyan-300 font-bold"
                                >
                                  Use Full Page Form →
                                </button>
                                {fiatAccount.linkedCards.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setShowInlineNewCard(false)}
                                    className="text-xs text-slate-400 hover:text-white bg-slate-800 px-2.5 py-1 rounded-lg"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-300 mb-1.5">16-Digit Debit Card Number</label>
                              <input
                                type="text"
                                maxLength={19}
                                value={inlineCardNum}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, '').slice(0, 16);
                                  const formatted = val.match(/.{1,4}/g)?.join(' ') || val;
                                  setInlineCardNum(formatted);
                                }}
                                placeholder="4532 •••• •••• 8823"
                                className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500 tracking-wider"
                              />
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Exp Month</label>
                                <select
                                  value={inlineCardExpMonth}
                                  onChange={(e) => setInlineCardExpMonth(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5"
                                >
                                  {Array.from({ length: 12 }).map((_, i) => {
                                    const m = String(i + 1).padStart(2, '0');
                                    return <option key={m} value={m}>{m}</option>;
                                  })}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Exp Year</label>
                                <select
                                  value={inlineCardExpYear}
                                  onChange={(e) => setInlineCardExpYear(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5"
                                >
                                  {[2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map((y) => (
                                    <option key={y} value={String(y)}>{y}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">CVV Security</label>
                                <input
                                  type="password"
                                  maxLength={4}
                                  value={inlineCardCvc}
                                  onChange={(e) => setInlineCardCvc(e.target.value.replace(/\D/g, ''))}
                                  placeholder="•••"
                                  className="w-full bg-slate-900 border border-slate-700 text-white font-mono text-xs rounded-xl px-3 py-2.5 text-center focus:outline-none focus:border-cyan-500 tracking-widest"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Cardholder Full Name</label>
                              <input
                                type="text"
                                value={inlineCardHolder}
                                onChange={(e) => setInlineCardHolder(e.target.value)}
                                placeholder="Legal name printed on card"
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-cyan-500"
                              />
                            </div>

                            {/* Save and Select Button */}
                            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                              {fiatAccount.linkedCards.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowInlineNewCard(false)}
                                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={handleSaveInlineCard}
                                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20"
                              >
                                {isLoading ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                <span>Save Debit Card & Select for Instant Push</span>
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/20 flex items-center gap-2 text-xs text-cyan-200">
                          <Zap className="h-4 w-4 text-cyan-400 shrink-0" />
                          <span>
                            <strong>Visa Direct & Mastercard Send:</strong> Real-time push rails clear directly to your bank account via your debit card in under 30 minutes with $0 fees.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* STEP 3: AMOUNT INPUT & PRESET CHIPS */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-300">
                        3. Withdrawal Amount (USD)
                      </label>
                      <span className="text-xs font-mono text-slate-400">
                        Available in {withdrawSource === 'TREASURY' ? 'Vault' : 'Bot'}:{' '}
                        <strong className="text-emerald-400">
                          {formatCurrency(withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash)}
                        </strong>
                      </span>
                    </div>

                    <div className="relative">
                      <span className="absolute left-3.5 top-2.5 text-slate-400 font-mono text-base font-bold">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0.01"
                        max={withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash}
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-white pl-8 pr-4 py-2.5 rounded-xl font-mono text-xl font-black focus:outline-none focus:border-cyan-500"
                        required
                      />
                    </div>

                    {/* Interactive Slider */}
                    {(() => {
                      const availableMax = Math.max(0, withdrawSource === 'TREASURY' ? (fiatAccount?.availableBalance || 0) : (botCash || 0));
                      const parsed = parseFloat(withdrawAmount);
                      const safeWithdrawNum = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
                      const safeSliderVal = availableMax > 0 ? Math.min(safeWithdrawNum, availableMax) : 0;
                      const percentLabel = availableMax > 0 ? Math.min(100, Math.max(0, (safeWithdrawNum / availableMax) * 100)).toFixed(0) : '0';

                      return (
                        <div className="mt-3 px-1">
                          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                            <span className="flex items-center gap-1">
                              <SlidersHorizontal className="h-3 w-3 text-cyan-400" />
                              Interactive Allocation Slider
                            </span>
                            <span className="text-cyan-300 font-bold">
                              {percentLabel}% of capital
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max={Math.max(1, availableMax)}
                            step="0.01"
                            value={Number.isFinite(safeSliderVal) ? safeSliderVal : 0}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                        </div>
                      );
                    })()}

                    {/* Quick Percentage & Amount Preset Chips */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 font-mono">Presets:</span>
                        {[250, 500, 1000, 5000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setWithdrawAmount(String(preset))}
                            className="px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] font-mono cursor-pointer transition-all"
                          >
                            +${preset}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {[0.25, 0.5, 0.75, 1].map((pct) => {
                          const currentPool = withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash;
                          const calculated = (currentPool * pct).toFixed(2);
                          const label = pct === 1 ? 'MAX (100%)' : `${pct * 100}%`;
                          return (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => setWithdrawAmount(calculated)}
                              className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold cursor-pointer transition-all ${
                                pct === 1
                                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Post-Withdrawal Remaining Balance Indicator */}
                    <div className="mt-2.5 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-400">Post-Withdrawal Remaining:</span>
                      <span className="font-bold text-white">
                        {formatCurrency(Math.max(0, (withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash) - parseFloat(withdrawAmount || '0')))}
                      </span>
                    </div>
                  </div>

                  {/* 2FA Security Token */}
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-cyan-400" />
                        <span>2FA Security Token</span>
                        <span className="text-[10px] text-slate-400 font-normal">(Required for &gt;$500)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setWithdraw2FaCode('123456')}
                        className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-2 py-0.5 rounded cursor-pointer transition-colors"
                      >
                        Autofill PIN (123456)
                      </button>
                    </div>
                    <input
                      type="text"
                      maxLength={6}
                      value={withdraw2FaCode}
                      onChange={(e) => setWithdraw2FaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 6-digit TOTP code (e.g. 123456)"
                      className="w-full bg-slate-950 border border-slate-700 text-white font-mono text-xs rounded-lg px-3 py-2 tracking-widest focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* STEP 4: FEE TRANSPARENCY & CLEARING SUMMARY */}
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1.5">
                    <div className="flex justify-between text-slate-300">
                      <span>Source Deduction ({withdrawSource === 'TREASURY' ? 'Treasury Vault' : 'Bot Cash'}):</span>
                      <span className="font-mono text-slate-200">
                        -${parseFloat(withdrawAmount || '0').toFixed(2)} USD
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Network Transfer & Custodial Clearing Fee:</span>
                      <span className="text-emerald-400 font-mono font-bold">$0.00 (Zero Fee)</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Estimated Payout Arrival:</span>
                      <span className="text-cyan-300 font-semibold">
                        {withdrawDestinationType === 'CARD'
                          ? '0 - 30 Minutes (Visa Direct Push)'
                          : withdrawRail === 'INSTANT_FEDNOW'
                          ? 'Immediate (0 - 10 Seconds via FedNow)'
                          : withdrawRail === 'SAME_DAY_WIRE'
                          ? 'Same-Day Wire Clearing'
                          : 'Next Banking Business Morning'}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline font-bold">
                      <span className="text-white">Net Payout to Recipient:</span>
                      <span className="text-base font-black font-mono text-emerald-400">
                        ${parseFloat(withdrawAmount || '0').toFixed(2)} USD
                      </span>
                    </div>
                  </div>

                  {/* EXECUTION BUTTON */}
                  <button
                    type="submit"
                    disabled={
                      isLoading ||
                      parseFloat(withdrawAmount || '0') <= 0 ||
                      parseFloat(withdrawAmount || '0') > (withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash)
                    }
                    className={`w-full py-3.5 rounded-xl font-bold text-xs cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg ${
                      parseFloat(withdrawAmount || '0') > (withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash)
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-rose-500 via-pink-600 to-rose-600 hover:from-rose-400 hover:to-pink-500 text-white active:scale-[0.99]'
                    }`}
                  >
                    <ArrowUpFromLine className="h-4 w-4" />
                    <span>
                      {isLoading
                        ? 'Clearing Withdrawal via Financial Rails...'
                        : parseFloat(withdrawAmount || '0') > (withdrawSource === 'TREASURY' ? fiatAccount.availableBalance : botCash)
                        ? 'Amount Exceeds Available Pool'
                        : `Execute Withdrawal of $${parseFloat(withdrawAmount || '0').toFixed(2)} USD`}
                    </span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 4: BOT CAPITAL TRANSFER */}
          {activeTab === 'TRANSFER_BOT' && (
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-xs font-bold text-white">Bridge Live Treasury & Algorithmic Trading Bot</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Move funds instantly between your secure live currency account and the active crypto trading margin.
                  </p>
                </div>
                <div className="text-right font-mono text-xs">
                  <div className="text-slate-400 text-[10px]">Bot Trading Cash</div>
                  <div className="text-cyan-400 font-bold">{formatCurrency(botCash)}</div>
                </div>
              </div>

              <form onSubmit={handleBotTransfer} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBotTransferDirection('TO_BOT')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      botTransferDirection === 'TO_BOT'
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5 text-emerald-400">
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      <span>Deposit to Trading Bot</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Live Fiat Vault ➔ Bot Trading Cash</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBotTransferDirection('FROM_BOT')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      botTransferDirection === 'FROM_BOT'
                        ? 'bg-cyan-500/10 border-cyan-500/50 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5 text-cyan-400">
                      <ArrowUpFromLine className="h-3.5 w-3.5" />
                      <span>Secure Bot Profits to Vault</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Bot Trading Cash ➔ Live Fiat Vault</div>
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-slate-400">Transfer Amount (USD)</label>
                    <span className="text-[10px] font-mono text-slate-400">
                      Available to Move:{' '}
                      <strong className="text-white">
                        {formatCurrency(botTransferDirection === 'TO_BOT' ? fiatAccount.availableBalance : botCash)}
                      </strong>
                    </span>
                  </div>

                  {/* Percentage Presets */}
                  <div className="flex gap-2 mb-2">
                    {[0.25, 0.5, 0.75, 1].map((pct) => {
                      const pool = botTransferDirection === 'TO_BOT' ? fiatAccount.availableBalance : botCash;
                      const val = Math.floor(pool * pct);
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setBotTransferAmount(String(val))}
                          className="flex-1 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500/40 text-slate-300 font-mono text-xs font-bold cursor-pointer transition-all hover:text-white"
                        >
                          {pct === 1 ? 'MAX (100%)' : `${pct * 100}%`}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-sm">$</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.01"
                      value={botTransferAmount}
                      onChange={(e) => setBotTransferAmount(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-white pl-8 pr-4 py-2.5 rounded-xl font-mono text-base font-bold focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  <span>
                    Execute Internal Transfer (${parseFloat(botTransferAmount || '0').toFixed(2)})
                  </span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 5: AUDIT LEDGER */}
          {activeTab === 'LEDGER' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Receipt className="h-4 w-4 text-cyan-400" />
                    Immutable Proof-of-Reserves Activity Log
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Cryptographically hashed records across FedNow, Visa Direct, and ACH banking rails.
                  </p>
                </div>
                <span className="font-mono text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full self-start sm:self-auto">
                  {transactions.length} Verified Entries
                </span>
              </div>

              {/* Interactive Search & Filter Controls */}
              <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                <div className="relative w-full sm:flex-1">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    placeholder="Search by bank, card, rail, or hash..."
                    className="w-full bg-slate-950 border border-slate-800 text-xs text-white pl-8 pr-3 py-1.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  {ledgerSearch && (
                    <button
                      type="button"
                      onClick={() => setLedgerSearch('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                  <button
                    type="button"
                    onClick={() => setLedgerFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold cursor-pointer transition-all ${
                      ledgerFilter === 'ALL'
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    All ({transactions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLedgerFilter('WITHDRAW')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold cursor-pointer transition-all ${
                      ledgerFilter === 'WITHDRAW'
                        ? 'bg-rose-500 text-white font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-300'
                    }`}
                  >
                    Withdrawals ({transactions.filter((t) => t.type.includes('WITHDRAW')).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLedgerFilter('DEPOSIT')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold cursor-pointer transition-all ${
                      ledgerFilter === 'DEPOSIT'
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-emerald-300'
                    }`}
                  >
                    Deposits ({transactions.filter((t) => t.type.includes('DEPOSIT') || t.type.includes('LOAD')).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLedgerFilter('BOT_TRANSFER')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold cursor-pointer transition-all ${
                      ledgerFilter === 'BOT_TRANSFER'
                        ? 'bg-blue-500 text-white font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-cyan-300'
                    }`}
                  >
                    Bot Bridge ({transactions.filter((t) => t.type.includes('BOT')).length})
                  </button>
                </div>
              </div>

              {/* Transactions List */}
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {(() => {
                  const filtered = transactions.filter((tx) => {
                    if (ledgerFilter === 'WITHDRAW' && !tx.type.includes('WITHDRAW')) return false;
                    if (ledgerFilter === 'DEPOSIT' && !(tx.type.includes('DEPOSIT') || tx.type.includes('LOAD'))) return false;
                    if (ledgerFilter === 'BOT_TRANSFER' && !tx.type.includes('BOT')) return false;
                    if (ledgerSearch.trim()) {
                      const q = ledgerSearch.toLowerCase();
                      const matchSource = tx.sourceName?.toLowerCase().includes(q);
                      const matchDest = tx.destinationName?.toLowerCase().includes(q);
                      const matchHash = tx.referenceHash?.toLowerCase().includes(q);
                      const matchRail = tx.rail?.toLowerCase().includes(q);
                      if (!matchSource && !matchDest && !matchHash && !matchRail) return false;
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="p-8 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/60">
                        No transactions found matching the current filter or search criteria.
                      </div>
                    );
                  }

                  return filtered.map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition-all text-xs group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-cyan-400">
                          {tx.type.includes('DEPOSIT') || tx.type.includes('LOAD') ? (
                            <ArrowDownToLine className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <ArrowUpFromLine className="h-4 w-4 text-cyan-400" />
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>{tx.sourceName}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                              {tx.rail}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                            <span>{new Date(tx.timestamp).toLocaleString()}</span>
                            <span>•</span>
                            <span className="font-mono text-slate-500">Hash: {tx.referenceHash}</span>
                            <button
                              onClick={() => copyToClipboard(tx.referenceHash)}
                              className="text-slate-400 hover:text-cyan-300"
                              title="Copy transaction hash"
                            >
                              {copiedHash === tx.referenceHash ? (
                                <Check className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                            <button
                              onClick={() => downloadReceiptText(tx)}
                              className="text-slate-400 hover:text-emerald-400 flex items-center gap-1 cursor-pointer"
                              title="Download Proof of Settlement (.txt)"
                            >
                              <Download className="h-3 w-3" />
                              <span>Receipt</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-mono">
                        <div
                          className={`font-bold ${
                            tx.type.includes('WITHDRAW') ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {tx.type.includes('WITHDRAW') ? '-' : '+'}
                          {formatCurrency(tx.amount)}
                        </div>
                        <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Footer Security Badge */}
        <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Custodial Trust Partner: Cross River / Evolve Bank & Trust (Member FDIC)</span>
            </span>
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            Account: {fiatAccount.accountNumberMasked}
          </div>
        </div>
      </div>
    </div>
  );
};
