/**
 * The `result` of GET /v5/user/query-api, copied from Bybit's documented example
 * (fetched 2026-09-17). Note the example is read-only yet lists trade permissions.
 */
export const QUERY_API_RESULT = {
  id: '2208369',
  note: 'testnet',
  apiKey: 'XXXXXXXX',
  readOnly: 1,
  secret: '',
  permissions: {
    ContractTrade: ['Order', 'Position'],
    Spot: ['SpotTrade'],
    Wallet: ['AccountTransfer', 'SubMemberTransfer'],
    Options: [],
    Derivatives: ['DerivativesTrade'],
    CopyTrading: [],
    BlockTrade: [],
    Exchange: ['ExchangeHistory'],
    NFT: [],
    Affiliate: [],
    Earn: ['Earn'],
    FiatP2P: ['FiatP2POrder', 'Advertising'],
    FiatConvertBroker: ['FiatConvertBrokerOrder'],
    FiatGlobalPay: [],
    FiatBitPay: ['FaitPayOrder'],
    BitCard: ['BitCard'],
    ByXPost: ['ByXPost'],
  },
  ips: ['18.181.170.164', '13.212.45.47', '13.212.45.48'],
  type: 1,
  deadlineDay: -2,
  expiredAt: '1970-01-01T00:00:00Z',
  createdAt: '2025-10-13T03:20:45Z',
  unified: 0,
  uta: 1,
  userID: 1448939,
  inviterID: 0,
  vipLevel: 'PRO-1',
  mktMakerLevel: '0',
  affiliateID: 0,
  rsaPublicKey: '',
  isMaster: true,
  parentUid: '0',
  kycLevel: 'LEVEL_1',
  kycRegion: 'MYS',
  isFixApi: false,
};

/**
 * The `result` of GET /v5/account/wallet-balance?accountType=UNIFIED, shaped
 * after Bybit's documented example: every number is a string, and some optional
 * fields arrive as "". Values are illustrative.
 */
export const WALLET_BALANCE_RESULT = {
  list: [
    {
      accountType: 'UNIFIED',
      totalEquity: '1260.12',
      totalWalletBalance: '1260.12',
      coin: [
        { coin: 'BTC', walletBalance: '0.00012345', locked: '0', borrowAmount: '', equity: '0.00012345', usdValue: '9.45' },
        { coin: 'USDT', walletBalance: '1250.123456', locked: '10.5', borrowAmount: '0', equity: '1250.123456', usdValue: '1250.67' },
        { coin: 'ETH', walletBalance: '0', locked: '', borrowAmount: '', equity: '0', usdValue: '0' },
      ],
    },
  ],
};
