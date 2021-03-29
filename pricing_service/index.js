const axios = require("axios");
const _ = require("underscore");
const httpsProxyAgent = require("https-proxy-agent");
const https = require("https");
const config = require("../config.json");

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
  const url = `https://api-public.sandbox.pro.coinbase.com/products/${symbol}/stats`;
  let res;
  if (proxy.enable) {
    res = await makeHttpsRequestWithProxy(url, proxy);
  } else {
    res = await makeHttpsRequest(url);
  }
  res = res.data;
  return {
    source: "Coinbase",
    symbol: symbol,
    price: res.last,
    volume: res.volume,
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

async function makeBatchCoinGeckoRequest(symbols, proxy) {
  if (!symbols || !symbols.length) {
    return {};
  }
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.join()}&vs_currencies=usd&include_24hr_vol=true`;
  let res;
  if (proxy.enable) {
    res = await makeHttpsRequestWithProxy(url, proxy);
  } else {
    res = await makeHttpsRequest(url);
  }
  res = res.data;
  return symbols.reduce((accum, symbol) => {
    accum[symbol] = {
      source: "CoinGecko",
      symbol: symbol,
      price: res[symbol].usd,
      volumeUSD: res[symbol].usd_24h_vol,
    };
    return accum;
  }, {});
}

// HTTP API is used as the primary source of prices
const HTTP = async (data, proxy) => {
  const otherData = data.filter((x) => x.exchange !== "CoinGecko");
  const coingeckoData = data.filter((x) => x.exchange === "CoinGecko");
  const coingeckoSymbols = coingeckoData.map((x) => {
    return config.sources["CoinGecko"][x.from].symbol;
  });

  let requests = otherData.map(async (x) => {
    const exchange = x.exchange;
    let res = {};
    if (exchange === "Coinbase" && config.sources["Coinbase"][x.from]) {
      res = await makeCoinbaseRequest(
        config.sources["Coinbase"][x.from].symbol,
        proxy
      );
    } else if (exchange === "Huobi" && config.sources["Huobi"][x.from]) {
      res = await makeHuobiRequest(
        config.sources["Huobi"][x.from].symbol,
        proxy
      );
    } else if (exchange === "Binance" && config.sources["Binance"][x.from]) {
      res = await makeBinanceRequest(
        config.sources["Binance"][x.from].symbol,
        proxy
      );
    } else if (exchange === "OKEX" && config.sources["OKEX"][x.from]) {
      res = await makeOKEXRequest(config.sources["OKEX"][x.from].symbol, proxy);
    }
    let uniqueId = x.from + x.exchange;
    let from = x.from;
    return {
      uniqueId,
      exchange,
      from,
      data: res,
    };
  });

  // coingecko supports batch request
  requests.push(makeBatchCoinGeckoRequest(coingeckoSymbols, proxy));

  const responses = await axios.all(requests);
  const otherResponses = responses.slice(0, responses.length - 1);
  const coingeckoResponses = responses[responses.length - 1];

  let result = otherResponses.reduce((accum, res) => {
    let prefix = "$";
    accum[res.uniqueId] = {
      exchange: res.exchange,
      from: res.from,
      flag: 4,
      price: res.data.price,
      volume24h: res.data.volumeUSD,
      prefix: prefix,
    };
    return accum;
  }, {});

  return coingeckoData.reduce((accum, x) => {
    let uniqueId = x.from + x.exchange;
    let prefix = "$";
    let symbol = config.sources["CoinGecko"][x.from].symbol;
    accum[uniqueId] = {
      exchange: x.exchange,
      from: x.from,
      flag: 4,
      price: coingeckoResponses[symbol].price,
      volume24h: coingeckoResponses[symbol].volumeUSD,
      prefix: prefix,
    };
    return accum;
  }, result);
};
let refreshIntervalId;

let Socket = {
  update: (store, state) => {
    let selectedCurrencies = store.get("preferences").currencies;
    let proxy = store.get("preferences").proxy;
    let refreshInterval = store.get("preferences").refreshInterval;
    let data = {};
    let dataBkp = {};

    // throttle state updates to prevent performance degradation
    let throttle = _.throttle(state, 5000);

    HTTP(selectedCurrencies, proxy).then((result) => {
      dataBkp = result;
      throttle(Object.assign(dataBkp, data));
    });

    // remove previous interval if existing
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
    }

    // create new interval for pooling
    refreshIntervalId = setInterval(() => {
      HTTP(selectedCurrencies, proxy).then((result) => {
        dataBkp = result;
        throttle(Object.assign(dataBkp, data));
      });
    }, refreshInterval);
  },
};

module.exports = Socket;
