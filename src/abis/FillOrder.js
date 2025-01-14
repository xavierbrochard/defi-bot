const FILL_ORDER_ABI = {
  constant: false,
  inputs: [
    {
      components: [
        { internalType: "address", name: "makerAddress", type: "address" },
        { internalType: "address", name: "takerAddress", type: "address" },
        {
          internalType: "address",
          name: "feeRecipientAddress",
          type: "address",
        },
        { internalType: "address", name: "senderAddress", type: "address" },
        { internalType: "uint256", name: "makerAssetAmount", type: "uint256" },
        { internalType: "uint256", name: "takerAssetAmount", type: "uint256" },
        { internalType: "uint256", name: "makerFee", type: "uint256" },
        { internalType: "uint256", name: "takerFee", type: "uint256" },
        {
          internalType: "uint256",
          name: "expirationTimeSeconds",
          type: "uint256",
        },
        { internalType: "uint256", name: "salt", type: "uint256" },
        { internalType: "bytes", name: "makerAssetData", type: "bytes" },
        { internalType: "bytes", name: "takerAssetData", type: "bytes" },
        { internalType: "bytes", name: "makerFeeAssetData", type: "bytes" },
        { internalType: "bytes", name: "takerFeeAssetData", type: "bytes" },
      ],
      internalType: "struct LibOrder.Order",
      name: "order",
      type: "tuple",
    },
    { internalType: "uint256", name: "takerAssetFillAmount", type: "uint256" },
    { internalType: "bytes", name: "signature", type: "bytes" },
  ],
  name: "fillOrder",
  outputs: [
    {
      components: [
        {
          internalType: "uint256",
          name: "makerAssetFilledAmount",
          type: "uint256",
        },
        {
          internalType: "uint256",
          name: "takerAssetFilledAmount",
          type: "uint256",
        },
        { internalType: "uint256", name: "makerFeePaid", type: "uint256" },
        { internalType: "uint256", name: "takerFeePaid", type: "uint256" },
        { internalType: "uint256", name: "protocolFeePaid", type: "uint256" },
      ],
      internalType: "struct LibFillResults.FillResults",
      name: "fillResults",
      type: "tuple",
    },
  ],
  payable: true,
  stateMutability: "payable",
  type: "function",
};

module.exports = FILL_ORDER_ABI;
