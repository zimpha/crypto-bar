const axios = require("axios");
const _ = require("underscore");
const httpsProxyAgent = require("https-proxy-agent");
const https = require("https");
const config = require("../config.json");
let socket;

async function makeHttpsRequestWithProxy(url, proxy) {
  return await axios.get(url, {
    httpsAgent: new httpsProxyAgent(
      `${proxy.protocol}://${proxy.server}:${proxy.port}`
    ),
  });
}

async function makeHttpsRequest(url) {
  return await axios.get(url, {
    httpsAgent: new https.Agent(),
  });
}

async function makeOKEXRequest(symbol, proxy) {
  if (!symbol) {
    return {
      source: "OKEX",
      symbol: symbol,
    };
  }
  const url = `https://www.okex.com/api/v5/market/ticker?instId=${symbol}`;
  let res;
  if (proxy.enable) {
    res = await makeHttpsRequestWithProxy(url, proxy);
  } else {
    res = await makeHttpsRequest(url);
  }
  res = res.data.data[0];
  return {
    source: "OKEX",
    symbol: symbol,
    price: res.last,
    volume: res.vol24h,
    volumeUSD: res.volCcy24h,
  };
}

async function makeHuobiRequest(symbol, proxy) {
  if (!symbol) {
    return {
      source: "Huobi",
      symbol: symbol,
    };
  }
  const volUrl = `https://api.huobi.pro/market/detail?symbol=${symbol}`;
  const priceUrl = `https://api.huobi.pro/market/trade?symbol=${symbol}`;
  let responses;
  if (proxy.enable) {
    responses = await axios.all([
      makeHttpsRequestWithProxy(volUrl, proxy),
      makeHttpsRequestWithProxy(priceUrl, proxy),
    ]);
  } else {
    responses = await axios.all([
      makeHttpsRequest(volUrl),
      makeHttpsRequest(priceUrl),
    ]);
  }
  return {
    source: "Huobi",
    symbol: symbol,
    price: responses[1].data.tick.data[0].price,
    volume: responses[0].data.tick.amount,
    volumeUSD: responses[0].data.tick.vol,
  };
}

async function makeBinanceRequest(symbol, proxy) {
  if (!symbol) {
    return {
      source: "Binance",
      symbol: symbol,
    };
  }
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  let res;
  if (proxy.enable) {
    res = await makeHttpsRequestWithProxy(url, proxy);
  } else {
    res = await makeHttpsRequest(url);
  }
  res = res.data;
  return {
    source: "Binance",
    symbol: symbol,
    price: res.lastPrice,
    volume: res.volume,
    volumeUSD: res.quoteVolume,
  };
}

async function makeCoinbaseRequest(symbol, proxy) {
  if (!symbol) {
    return {
      source: "Coinbase",
      symbol: symbol,
    };
  }
  const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symbol}&tsyms=USD&e=Coinbase`;
  let res;
  if (proxy.enable) {
    res = await makeHttpsRequestWithProxy(url, proxy);
  } else {
    res = await makeHttpsRequest(url);
  }
  res = res.data["RAW"][symbol]["USD"];
  return {
    source: "Coinbase",
    symbol: symbol,
    price: res["PRICE"],
    volume: res["VOLUME24HOUR"],
    volumeUSD: res["VOLUME24HOURTO"],
  };
}

async function makeCoinGeckoRequest(symbol, proxy) {
  if (!symbol) {
    return {
      source: "CoinGecko",
      symbol: symbol,
    };
  }
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd&include_24hr_vol=true`;
  let res;
  if (proxy.enable) {
    res = await makeHttpsRequestWithProxy(url, proxy);
  } else {
    res = await makeHttpsRequest(url);
  }
  res = res.data[symbol];
  return {
    source: "CoinGecko",
    symbol: symbol,
    price: res.usd,
    volumeUSD: res.usd_24h_vol,
  };
}

// HTTP API is used as the primary source of prices
const HTTP = async (data, Config) => {
  const requests = data.map(async (x) => {
    let url = `https://min-api.cryptocompare.com/data/price?fsym=${x.from}&tsyms=${x.to}&e=${x.exchange}`;
    //let res = await axios.get(url);
    let exchange = x.exchange;
    let exchangeFallback = false;

    /*if (res.data[x.to] == undefined) {
      url = `https://min-api.cryptocompare.com/data/price?fsym=${x.from}&tsyms=${x.to}`;
      res = await axios.get(url);
      exchangeFallback = "CCCAGG";
    }
    res = res.data;*/

    let res;
    if (x.exchange == "OKEX") {
      res = await makeCoinGeckoRequest(Config.sources["CoinGecko"][x.from].symbol, Config.proxy);
    } else if (x.exchange == "Huobi") {
      res = await makeCoinGeckoRequest(Config.sources["CoinGecko"][x.from].symbol, Config.proxy);
    } else if (x.exchange == "Binance") {
      res = await makeCoinGeckoRequest(Config.sources["CoinGecko"][x.from].symbol, Config.proxy);
    } else if (x.exchange == "Coinbase") {
      res = await makeCoinGeckoRequest(Config.sources["CoinGecko"][x.from].symbol, Config.proxy);
    } else if (x.exchange == "CoinGecko") {
      res = await makeCoinGeckoRequest(Config.sources["CoinGecko"][x.from].symbol, Config.proxy);
    } else {
      res = {};
    }

    let uniqueId = x.from + x.to + x.exchange;
    let from = x.from;
    let to = x.to;

    return {
      uniqueId,
      exchange,
      exchangeFallback,
      from,
      to,
      data: res,
    };
  });
  const responses = await axios.all(requests);

  return responses.reduce((accum, res) => {
    let prefix = Config.currencies.filter((x) => x.label === res.to)[0].prefix;
    accum[res.uniqueId] = {
      exchange: res.exchange,
      exchangeFallback: res.exchangeFallback,
      from: res.from,
      to: res.to,
      flag: 4,
      price: res.data.price,
      volume24h: res.data.volumeUSD,
      prefix: prefix,
    };
    return accum;
  }, {});
};
let refreshIntervalId;

let Socket = {
  connect: (store, tray, getImage, Config, state) => {
    socket = require("socket.io-client")("https://streamer.cryptocompare.com/");
    let selectedCurrencies = store.get("preferences").currencies;
    let data = {};
    let dataBkp = {};
    let dataFallback = {};
    let subscription = [];
    for (let i of selectedCurrencies) {
      subscription.push(`2~${i.exchange}~${i.from}~${i.to}`);
    }

    socket.emit("SubAdd", {
      subs: subscription,
    });

    // throttle state updates to prevent performance degradation
    let throttle = _.throttle(state, 5000);

    HTTP(selectedCurrencies, Config).then((result) => {
      dataBkp = result;
      throttle(Object.assign(dataBkp, data));
    });

    // remove previous interval if existing
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
    }

    // create new interval for pooling
    refreshIntervalId = setInterval(() => {
      HTTP(selectedCurrencies, Config).then((result) => {
        dataBkp = result;
        throttle(Object.assign(dataBkp, data));
      });
    }, 30000);

    socket.on("m", (message) => {
      let messageArray = message.split("~");

      subscription.map((x) => {
        let xArray = x.split("~");
        if (xArray[2] === messageArray[2] && xArray[3] === messageArray[3]) {
          let prefix = Config.currencies.filter(
            (x) => x.label === messageArray[3]
          )[0].prefix;
          let concatData = messageArray.concat(prefix);
          if (concatData.length === 14) {
            data[concatData[2] + concatData[3] + concatData[1]] = {
              exchange: concatData[1],
              from: concatData[2],
              to: concatData[3],
              flag: concatData[4],
              price: concatData[5],
              volume24h: concatData[10],
              prefix: concatData[13],
            };
          }
        }
      });
      throttle(Object.assign(dataBkp, data));
    });
  },

  disconnect: () => {
    socket.disconnect();
  },
};

module.exports = Socket;
