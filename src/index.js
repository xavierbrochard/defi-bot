require("dotenv").config();
require("console.table");
const express = require("express");
const path = require("path");
const player = require("play-sound")((opts = {}));
const http = require("http");
const cors = require("cors");
const Web3 = require("web3");
const axios = require("axios");
const moment = require("moment-timezone");
const numeral = require("numeral");
const _ = require("lodash");

const ONE_SPLIT_ABI = require("./abis/OneSplit");

// SERVER CONFIG
const PORT = process.env.PORT || 5000;
const app = express();
const server = http
  .createServer(app)
  .listen(PORT, () => console.log(`Listening on ${PORT}`));
app.use(express.static(path.join(__dirname, "public")));
app.use(cors({ credentials: true, origin: "*" }));

// WEB3 CONFIG
const web3 = new Web3(process.env.RPC_URL);
web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

// SMART CONTRACTS

const ONE_SPLIT_ADDRESS = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";
const oneSplitContract = new web3.eth.Contract(
  ONE_SPLIT_ABI,
  ONE_SPLIT_ADDRESS
);

const ZRX_EXCHANGE_ADDRESS = "0x61935CbDd02287B511119DDb11Aeb42F1593b7Ef";
const ZRX_EXCHANGE_ABI = require("./abis/ZrxExchange");

const zrxExchangeContract = new web3.eth.Contract(
  ZRX_EXCHANGE_ABI,
  ZRX_EXCHANGE_ADDRESS
);

const TRADER_ABI = require("./abis/Trader");
const TRADER_ADDRESS = process.env.CONTRACT_ADDRESS;

const traderContract = new web3.eth.Contract(TRADER_ABI, TRADER_ADDRESS);
const FILL_ORDER_ABI = require("./abis/FillOrder");

// ESCHANGE NAMES
// https://api.1inch.exchange/v1.1/exchanges
const ZERO_X = "0x";
const ONE_SPLIT = "1Split";

// ASSET SYMBOLS
const DAI = "DAI";
const WETH = "WETH";
const SAI = "SAI";
const USDC = "USDC";

// ASSET ADDRESSES
// https://api.1inch.exchange/v1.1/tokens
const ASSET_ADDRESSES = {
  DAI: "0x6b175474e89094c44da98b954eedeac495271d0f",
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  SAI: "0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359",
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
};

// DISPLAY LOGIC
const tokensWithDecimalPlaces = (amount, symbol) => {
  amount = amount.toString();
  switch (symbol) {
    case DAI: // 18 decimals
      return web3.utils.fromWei(amount, "ether");
    default:
      return web3.utils.fromWei(amount, "ether");
  }
};

const TOKEN_DISPLAY_DECIMALS = 2; // Show 2 decimal places
const displayTokens = (amount, symbol) => {
  let tokens;
  tokens = tokensWithDecimalPlaces(amount, symbol);
  return tokens;
};

// UTILITIES
const now = () => moment().tz("America/Chicago").format();

const SOUND_FILE = "ding.mp3";
const playSound = () => {
  player.play(SOUND_FILE, function (err) {
    if (err) {
      console.log("Error playing sound!");
    }
  });
};

// FORMATTERS
const toTokens = (tokenAmount, symbol) => {
  switch (symbol) {
    case DAI: // 18 decimals
      return web3.utils.toWei(tokenAmount, "Ether");
    case WETH: // 18 decimals
      return web3.utils.toWei(tokenAmount, "Ether");
    case USDC: // 6 decimals
      return web3.utils.fromWei(web3.utils.toWei(tokenAmount), "szabo");
  }
};

// TRADING FUNCTIONS
// TODO if you configure the ONE_SPLIT_PARTS in the getExpectedReturn function, then you can swap from any dex to any dex actually
const ONE_SPLIT_PARTS = 10;
const ONE_SPLIT_FLAGS = 0;
// TODO move the following function to where it is called, i.e. we don't need this as a separate function as it's only used once in the code
async function fetchOneSplitData(args) {
  const { fromToken, toToken, amount } = args;
  // https://etherscan.io/address/0xc586bef4a0992c495cf22e1aeee4e446cecdee0e#readContract
  // https://etherscan.io/address/0x96b610046d63638d970e6243151311d8827d69a5#readContract
  // TODO why not use this API call instead? https://api.1inch.exchange/v1.1/quote?fromTokenSymbol=ETH&toTokenSymbol=DAI&amount=100000000000000000000
  const data = await oneSplitContract.methods
    .getExpectedReturn(
      fromToken,
      toToken,
      amount,
      ONE_SPLIT_PARTS,
      ONE_SPLIT_FLAGS
    )
    .call();
  return data;
}

// CHECK TO SEE IF ORDER CAN BE ARBITRAGED
const checkedOrders = [];
let profitableArbFound = false;
async function checkArb(args) {
  const { zrxOrder, metadata, assetOrder } = args;

  // Track order
  // TODO remove this check! I.e. just because the order on 0x hasn't changed doesn't mean that the AMM prices haven't changed.
  // Also, once I will handle partially filled orders, it will be important to check orders again as the fill amount may have increased
  const tempOrderID = JSON.stringify(zrxOrder);
  let amountLeft = metadata.remainingFillableTakerAssetAmount;

  // Skip if order checked
  if (checkedOrders.includes(tempOrderID)) {
    // console.log('Order already checked')
    return; // Don't log
  }

  // Add to checked orders
  checkedOrders.push(tempOrderID);

  // Skip if Maker Fee
  // TODO does this even make sense? The bot is always going to be the taker, plus I haven't yet seen any maker fee on 0x other than 0
  if (zrxOrder.makerFee.toString() !== "0") {
    console.log("Order has maker fee");
    return;
  }

  // This becomes the input amount
  let inputAssetAmount = zrxOrder.takerAssetAmount;

  // Build order tuple
  const orderTuple = [
    zrxOrder.makerAddress, // Address that created the order.
    zrxOrder.takerAddress, // Address that is allowed to fill the order. If set to 0, any address is allowed to fill the order.
    zrxOrder.feeRecipientAddress, // Address that will recieve fees when order is filled.
    zrxOrder.senderAddress, // Address that is allowed to call Exchange contract methods that affect this order. If set to 0, any address is allowed to call these methods.
    zrxOrder.makerAssetAmount, // Amount of makerAsset being offered by maker. Must be greater than 0.
    zrxOrder.takerAssetAmount, // Amount of takerAsset being bid on by maker. Must be greater than 0.
    zrxOrder.makerFee, // Fee paid to feeRecipient by maker when order is filled.
    zrxOrder.takerFee, // Fee paid to feeRecipient by taker when order is filled.
    zrxOrder.expirationTimeSeconds, // Timestamp in seconds at which order expires.
    zrxOrder.salt, // Arbitrary number to facilitate uniqueness of the order's hash.
    zrxOrder.makerAssetData, // Encoded data that can be decoded by a specified proxy contract when transferring makerAsset. The leading bytes4 references the id of the asset proxy.
    zrxOrder.takerAssetData, // Encoded data that can be decoded by a specified proxy contract when transferring takerAsset. The leading bytes4 references the id of the asset proxy.
    zrxOrder.makerFeeAssetData, // Encoded data that can be decoded by a specified proxy contract when transferring makerFeeAsset. The leading bytes4 references the id of the asset proxy.
    zrxOrder.takerFeeAssetData, // Encoded data that can be decoded by a specified proxy contract when transferring takerFeeAsset. The leading bytes4 references the id of the asset proxy.
  ];

  // Fetch order status
  // const orderInfo = await zrxExchangeContract.methods.getOrderInfo(orderTuple).call()
  /*
  	struct OrderInfo {
    uint8 orderStatus;                    // Status that describes order's validity and fillability.
    bytes32 orderHash;                    // EIP712 hash of the order (see LibOrder.getOrderHash).
    uint256 orderTakerAssetFilledAmount;  // Amount of order that has already been filled.
	}
	*/
  // TODO use this public mapping to see the order filled amount https://0x.org/docs/guides/v3-specification#filled

  // console.log(typeof inputAssetAmount)
  // Skip if order has been partially filled
  // if(orderInfo.orderTakerAssetFilledAmount.toString() !== '0') {
  if (amountLeft != zrxOrder.takerAssetAmount) {
    amountLeft = web3.utils.fromWei(
      metadata.remainingFillableTakerAssetAmount,
      "ether"
    ); // typeof = string
    if (amountLeft < 0.01) {
      console.log("SKIP order taker asset left less than 0.01");
      return;
    }
    // TODO inputamount needs to equal amountleft
    // I'm HERE <<<=========
    console.log("Order taker asset remaining: " + amountLeft);
  }

  // Fetch 1Split Data
  const oneSplitData = await fetchOneSplitData({
    fromToken: ASSET_ADDRESSES[assetOrder[1]],
    toToken: ASSET_ADDRESSES[assetOrder[2]],
    amount: zrxOrder.makerAssetAmount,
  });

  // This becomes the outputAssetAmount
  const outputAssetAmount = oneSplitData.returnAmount;

  // Calculate estimated gas cost
  let estimatedGasFee =
    process.env.ESTIMATED_GAS.toString() *
    web3.utils.toWei(process.env.GAS_PRICE.toString(), "Gwei");

  let netProfit;

  if (zrxOrder.takerFee.toString() !== "0") {
    // the fee's currency is the taker asset, i.e. DAI
    // TODO make the net profit calculation look cleaner by assigning the results of if statements to constants
    // e.g. the below line should look like: if(takerFeeAsset == ASSET_ADDRESSES[assetOrder[0])
    if (
      "0x" + zrxOrder.takerFeeAssetData.substring(34, 74) ==
      ASSET_ADDRESSES[assetOrder[0]]
    ) {
      console.log(
        "Order has taker fees, payable in TAKER asset: " + assetOrder[0]
      );
      // subtracting fee from net profit calculation
      // the fee currency is usually the taker asset, i.e. it is the same currency as the other amounts in the netProfit calculation and can be subtracted as is
      // however additional logic is needed to handle cases where the taker fee is in the maker currency, which would require converting the amount to the taker currency amount before subtracting it
      netProfit =
        outputAssetAmount -
        inputAssetAmount -
        estimatedGasFee -
        zrxOrder.takerFee;
    } else if (
      "0x" + zrxOrder.takerFeeAssetData.substring(34, 74) ==
      ASSET_ADDRESSES[assetOrder[1]]
    ) {
      // could just be just an 'else', but better being explicit
      console.log(
        "Order has taker fees, payable in MAKER asset: " + assetOrder[1]
      );
      return; // TODO remove this and account for change of asset in net profit calculation
    } else {
      // this should never be the case, but better be safe.
      // I.e. it is neither 0x nor taker or maker asset address
      console.log(
        "takerFeeAssetData not recognized: " + zrxOrder.takerFeeAssetData
      );
      return;
    }
  } else {
    // If order has no fees (if maker fees wer)
    // Calculate net profit
    netProfit = outputAssetAmount - inputAssetAmount - estimatedGasFee;
  }

  netProfit = Math.floor(netProfit); // Round down

  // Determine if profitable
  const profitable = netProfit.toString() > "0";

  // If profitable, then stop looking and trade!
  if (profitable) {
    console.log(zrxOrder);
    // Skip if another profitable arb has already been found
    // TODO remove this check, this value will be set to true never not back to false, meaning the bot will stop after the first arb
    // doesnt even make much sense since if this is always true, the interval will always clear, why return here after the bot has already done many api calls...
    if (profitableArbFound) {
      return;
    }

    // Tell the app that a profitable arb has been found
    profitableArbFound = true;

    // Log the arb
    console.table([
      {
        "Profitable?": profitable,
        "Asset Order": assetOrder.join(", "),
        "Exchange Order": "ZRX, 1Split",
        Input: displayTokens(inputAssetAmount, assetOrder[0]).padEnd(22, " "),
        Output: displayTokens(outputAssetAmount, assetOrder[0]).padEnd(22, " "),
        Profit: displayTokens(netProfit.toString(), assetOrder[0]).padEnd(
          22,
          " "
        ),
        Timestamp: now(),
      },
    ]);

    // Play alert tone
    playSound();

    // Call arb contract
    // await trade(assetOrder[0], ASSET_ADDRESSES[assetOrder[0]], ASSET_ADDRESSES[assetOrder[1]], zrxOrder, inputAssetAmount, oneSplitData)
    /*
  		TODO don't just settle for greater than 0 and then stop, rather finish going through all 0x orders and then chose the most profitable one to begin with!
			TODO even better, rather than going through them sequentially like an idiot, why not sort the orders by the best exchange rate first!?!?!?!
			TODO even better, why not go through all of them at once, then estimate how much is needed and get a flashloan for all the profitable orders, then arbitrage them all at once??
		*/
  }
}

// TRADE EXECUTION
async function trade(
  flashTokenSymbol,
  flashTokenAddress,
  arbTokenAddress,
  orderJson,
  fillAmount,
  oneSplitData
) {
  const FLASH_AMOUNT = toTokens("10000", flashTokenSymbol); // 10,000 WETH
  // TODO the amount should be dynamic based on the 0x order! or take a bigger flashloan to arb more than 1 0x order at once!
  const FROM_TOKEN = flashTokenAddress; // WETH
  const FROM_AMOUNT = fillAmount; // '1000000'
  const TO_TOKEN = arbTokenAddress;

  const ONE_SPLIT_SLIPPAGE = "0.995";
  // TODO, make that slippage dynamic. Also, why is the slippage calculated in here and not subtracted earlier when calculating profitability?

  // TODO remove duplication
  const orderTuple = [
    orderJson.makerAddress,
    orderJson.takerAddress,
    orderJson.feeRecipientAddress,
    orderJson.senderAddress,
    orderJson.makerAssetAmount,
    orderJson.takerAssetAmount,
    orderJson.makerFee,
    orderJson.takerFee,
    orderJson.expirationTimeSeconds,
    orderJson.salt,
    orderJson.makerAssetData,
    orderJson.takerAssetData,
    orderJson.makerFeeAssetData,
    orderJson.takerFeeAssetData,
  ];

  // Format ZRX function call data
  const takerAssetFillAmount = FROM_AMOUNT;
  const signature = orderJson.signature;
  const data = web3.eth.abi.encodeFunctionCall(FILL_ORDER_ABI, [
    orderTuple,
    takerAssetFillAmount,
    signature,
  ]);

  const minReturn = oneSplitData.returnAmount;
  const distribution = oneSplitData.distribution;

  // Calculate slippage
  const minReturnWtihSplippage = (minReturnWithSlippage = new web3.utils.BN(
    minReturn
  )
    .mul(new web3.utils.BN("995"))
    .div(new web3.utils.BN("1000"))
    .toString());

  //   Perform Trade
  const receipt = await traderContract.methods
    .getFlashloan(
      flashTokenAddress, // address flashToken,
      FLASH_AMOUNT, // uint256 flashAmount,
      arbTokenAddress, // address arbToken,
      data, // bytes calldata zrxData,
      minReturnWtihSplippage.toString(), // uint256 oneSplitMinReturn,
      distribution // uint256[] calldata oneSplitDistribution
    )
    .send({
      from: process.env.ADDRESS,
      gas: process.env.GAS_LIMIT,
      gasPrice: web3.utils.toWei(process.env.GAS_PRICE, "Gwei"),
    });
  console.log(receipt);
}

// FETCH ORDERBOOK
// https://0x.org/docs/api#get-srav3orderbook
// Bids will be sorted in descending order by price
async function checkOrderBook(baseAssetSymbol, quoteAssetSymbol) {
  console.log(`checkOrderBook ${baseAssetSymbol} ${quoteAssetSymbol}`);
  const baseAssetAddress = ASSET_ADDRESSES[baseAssetSymbol].substring(2, 42);
  const quoteAssetAddress = ASSET_ADDRESSES[quoteAssetSymbol].substring(2, 42);
  // https://api.0x.org/sra/v3/orders?page=1&perPage=1000&makerAssetProxyId=0xf47261b0&takerAssetProxyId=0xf47261b0&makerAssetAddress=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2&takerAssetAddress=0x6b175474e89094c44da98b954eedeac495271d0f
  const zrxResponse = await axios.get(
    `https://api.0x.org/sra/v3/orderbook?baseAssetData=0xf47261b0000000000000000000000000${baseAssetAddress}&quoteAssetData=0xf47261b0000000000000000000000000${quoteAssetAddress}&perPage=1000`
  );
  // TODO (optional) refactor, i.e. more readable by assigning the url params to variables for example
  const zrxData = zrxResponse.data;

  const bids = zrxData.bids.records;
  bids.map((o) => {
    checkArb({
      zrxOrder: o.order,
      metadata: o.metaData,
      assetOrder: [baseAssetSymbol, quoteAssetSymbol, baseAssetSymbol],
    }); // E.G. WETH, DAI, WETH
  });
}

// CHECK MARKETS
let checkingMarkets = false;
async function checkMarkets() {
  if (checkingMarkets) {
    return;
  }

  // TODO add strategies
  /*
  Could I use 1inch in order to do arbs between kyber and uniswap?
	Kyber, uniswap....
	e.g. instead of doing 0x to 1inch you need to do from exchange a to exchange b.
	defiprime.com/exchanges
	*/

  // Stop checking markets if already found
  // TODO remove this
  if (profitableArbFound) {
    clearInterval(marketChecker);
  }

  console.log(`Fetching market data @ ${now()} ...\n`);
  checkingMarkets = true;
  try {
    await checkOrderBook(WETH, DAI);
    await checkOrderBook(DAI, WETH);
    await checkOrderBook(SAI, WETH);
    await checkOrderBook(WETH, SAI);
    await checkOrderBook(USDC, WETH);
    await checkOrderBook(WETH, USDC);
    console.log("Finished");
  } catch (error) {
    console.error(error);
    checkingMarkets = false;
    return;
  }
  checkingMarkets = false;
}

// RUN APP
playSound();

// Check markets every n seconds
const POLLING_INTERVAL = process.env.POLLING_INTERVAL || 3000; // 3 seconds
const marketChecker = setInterval(async () => {
  console.log("Running");
  await checkMarkets();
}, POLLING_INTERVAL);
