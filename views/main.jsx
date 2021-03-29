'use babel';

import React from 'react';
import { ipcRenderer, remote } from 'electron'
import { Circle } from 'better-react-spinkit'
import VirtualizedSelect from 'react-virtualized-select'
import formatCurrency from 'format-currency'
import { Scrollbars } from 'react-custom-scrollbars';
import _ from 'underscore';
const { Menu, MenuItem } = remote
const main = remote.require('./main.js')
const config = require('../config.json')
const Socket = require('../pricing_service')
const iconColor = { color: '#675BC0' }
const menu = new Menu()
let prices;

export default class Main extends React.Component {

  constructor() {
    super()
    this.state = {
      version: null,
      data: [],
      updateAvailable: false,
      updateInfo: '',
      loading: true,
      page: 'home',
      subpage: 'main',
      currentSettings: {},
      selectedBox: main.store.get('preferences').currencies.filter(x => x.default)
        .map(x => x.from + x.exchange)[0],
      internetOffline: false,
      // currency setting related
      pairDropdownFrom: null,
      pairDropdownExchange: null,
      // proxy related
      enableProxy: main.store.get('preferences').proxy.enable,
      proxyProtocol: main.store.get('preferences').proxy.protocol,
      proxyServer: main.store.get('preferences').proxy.server,
      proxyPort: main.store.get('preferences').proxy.port,
      // price update related
      refreshInterval: main.store.get('preferences').refreshInterval / 1000
    };

    this.handleBox = this.handleBox.bind(this)
    this.handlePairAdd = this.handlePairAdd.bind(this)
    this.handlePairDropdownFrom = this.handlePairDropdownFrom.bind(this)
    this.handlePairDropdownExchange = this.handlePairDropdownExchange.bind(this)
    this.handlePairDelete = this.handlePairDelete.bind(this)
    this.handlePageUpdate = this.handlePageUpdate.bind(this)
    this.handleRefreshPref = this.handleRefreshPref.bind(this)
    this.handleOpen = this.handleOpen.bind(this)
    this.handleSocket = this.handleSocket.bind(this)
    this.handleOffline = this.handleOffline.bind(this)

    this.handleProxyFormChange = this.handleProxyFormChange.bind(this)
    this.handleProxySetting = this.handleProxySetting.bind(this)

    this.handleIntervalFormChange = this.handleIntervalFormChange.bind(this)
    this.handleIntervalSetting = this.handleIntervalSetting.bind(this)

    this.renderHomePage = this.renderHomePage.bind(this)
    this.renderLoadingPage = this.renderLoadingPage.bind(this)
    this.renderOfflinePage = this.renderOfflinePage.bind(this)
    this.renderSettingsPage = this.renderSettingsPage.bind(this)
    this.renderCurrencySettingPage = this.renderCurrencySettingPage.bind(this)
    this.renderAddCurrencyPage = this.renderAddCurrencyPage.bind(this)
    this.renderProxySettingPage = this.renderProxySettingPage.bind(this)
    this.renderIntervalSettingPage = this.renderIntervalSettingPage.bind(this)
  }

  handleBox(from, price, exchange, prefix) {
    let newSettings = main.store.get('preferences')
    newSettings['currencies'] = newSettings['currencies'].map(x => {
      if (x.from === from && x.exchange === exchange) {
        return {
          "exchange": x.exchange,
          "from": x.from,
          "default": true
        }
      } else {
        return {
          "exchange": x.exchange,
          "from": x.from,
          "default": false
        }
      }
    })
    main.store.set('preferences', newSettings)
    main.tray.setImage(main.getImage(from));
    main.tray.setTitle(`${prefix}${formatCurrency(price, { minFraction: 2, maxFraction: 8 })}`)
    this.setState({ currentSettings: newSettings, subpage: 'main' })
    this.setState({ selectedBox: from + exchange })
  }

  handleOpen(url) {
    main.open(url)
  }

  handlePairDropdownFrom(e) {
    this.setState({ pairDropdownFrom: e })
  }

  handlePairDropdownExchange(e) {
    this.setState({ pairDropdownExchange: e })
  }

  handlePairDelete(item) {
    let newSettings = main.store.get('preferences')
    newSettings['currencies'] = newSettings.currencies
      .filter((x, index) => { return item !== index })
    main.store.set('preferences', newSettings)
    this.setState({ currentSettings: newSettings })
    Socket.update(main.store, this.handleSocket)
  }

  handlePairAdd(e) {
    e.preventDefault();
    let newSettings = main.store.get('preferences')
    let newItem = [{
      "exchange": this.state.pairDropdownExchange.value,
      "from": this.state.pairDropdownFrom.value,
      "default": false
    }]
    newSettings['currencies'] = newSettings['currencies'].concat(newItem)
    main.store.set('preferences', newSettings)
    this.setState({ currentSettings: newSettings, page: 'home' })
    Socket.update(main.store, this.handleSocket)
  }

  handleRefreshPref() {
    Socket.update(main.store, this.handleSocket)
    this.setState({ page: 'home', internetOffline: false })
  }

  handlePageUpdate(page) {
    if (page === "setting.currency.add") {
      this.setState({
        pairDropdownExchange: null,
        pairDropdownFrom: null,
      })
    }
    this.setState({ page: page })
  }

  handleSocket(data) {
    if (main.store.get('preferences').currencies.length !== 0) {
      let keys = Object.keys(data);
      keys.sort();
      prices = keys.map(key => {
        return {
          priceData: data[key],
          direction: data[key].flag === '1' ? 'up' : 'down'
        }
      })
      this.setState({ data: prices })

      if (prices.length > 0) {
        this.setState({ loading: false })
      }

      if (prices.length == 0) {
        this.setState({ loading: true })
      }

      try {
        // Handle changes in the selected currency for the tray
        let selectedTray = main.store.get('preferences').currencies.filter(x => x.default)[0] || main.store.get('preferences').currencies[0]
        let trayData = data[selectedTray.from + selectedTray.exchange]
        main.tray.setImage(main.getImage(selectedTray.from));
        main.tray.setTitle(`${trayData.prefix}${formatCurrency(trayData.price, { minFraction: 2, maxFraction: 8 })}`)
      } catch (error) {
        console.log("Couldn't change the tray image")
      }
    } else {
      this.setState({
        data: [],
        loading: false
      })
      // No currency being monitored
      main.tray.setImage(main.getImage('blank'));
      main.tray.setTitle(`Empty`)

    }
  }

  handleOffline() {
    this.setState({ internetOffline: true })
  }

  handleProxySetting(e) {
    let newSettings = main.store.get('preferences')
    newSettings.proxy = {
      "enable": this.state.enableProxy,
      "protocol": this.state.proxyProtocol,
      "server": this.state.proxyServer,
      "port": this.state.proxyPort,
    }
    main.store.set('preferences', newSettings)
    this.setState({ currentSettings: newSettings, page: 'home' })
    Socket.update(main.store, this.handleSocket)
  }

  handleProxyFormChange(e) {
    const target = e.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    this.setState({
      [name]: value
    });
  }

  handleIntervalSetting(e) {
    let newSettings = main.store.get('preferences')
    newSettings.refreshInterval = this.state.refreshInterval * 1000
    main.store.set('preferences', newSettings)
    this.setState({ currentSettings: newSettings, page: 'home' })
    Socket.update(main.store, this.handleSocket)
  }

  handleIntervalFormChange(e) {
    const target = e.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    this.setState({
      [name]: value
    });
  }

  componentWillMount() {
    // right click menu
    let changePage = page => {
      this.setState({ page: page })
    }
    menu.append(new MenuItem({ label: 'About Crypto Bar', click() { main.open('https://github.com/zimpha/crypto-bar') } }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Home', click() { changePage('home') } }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Settings', click() { changePage('settings') } }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Quit', accelerator: 'CommandOrControl+Q', click() { main.app.quit() } }))

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      menu.popup(remote.getCurrentWindow())
    }, false)

    // Detect internet connection state
    window.addEventListener('online', this.handleRefreshPref)
    window.addEventListener('offline', this.handleOffline)

    let token2exchange = config.tickers.reduce((accum, x) => {
      accum[x.label] = Array.from([])
      return accum
    }, {})

    for (const [exchange, value] of Object.entries(config.sources)) {
      Object.keys(value).map((token) => {
        token2exchange[token].push(exchange)
      })
    }

    // Get current settings
    this.setState({
      token2exchange: token2exchange,
      currentSettings: main.store.get('preferences'),
      version: main.app.getVersion()
    })

    // Websocket data
    try {
      Socket.update(main.store, this.handleSocket)
    } catch (error) {
      this.setState({ loading: true })
      Socket.update(main.store, this.handleSocket)
    }


    // Handle main events
    ipcRenderer.on('update', function (event, result) {
      this.setState({ updateAvailable: result.updateAvailable, updateInfo: result.updateInfo })
      if (result.updateAvailable) {
        console.log(result)
      }
    }.bind(this))

    ipcRenderer.on('suspend', function (event, result) {
      this.handleOffline()
    }.bind(this))

    ipcRenderer.on('resume', function (event, result) {
      this.handleRefreshPref()
    }.bind(this))
  }

  renderHomePage(footer) {
    let preDirection = '1'
    let priceDirection = (dir) => {
      if (dir === "1") {
        preDirection = dir
        return <i className="fas fa-caret-up up" />
      } else if (dir === "2") {
        preDirection = dir
        return <i className="fas fa-caret-down down" />
      } else if (dir === '4' && preDirection === '1') {
        preDirection = '1'
        return <i className="fas fa-caret-up up" />
      } else if (dir === '4' && preDirection === '2') {
        preDirection = '2'
        return <i className="fas fa-caret-down down" />
      }
    }

    let currencyList = this.state.data.map((x, i) => {
      return (
        <div className="box" href="#" key={i} onClick={() =>
          this.handleBox(x.priceData.from, x.priceData.price, x.priceData.exchange, x.priceData.prefix)}>
          <div className="currency">
            {x.priceData.from} <span className="exchange">({x.priceData.exchange})</span>
          </div>
          <div className="price">
            {!x.priceData.price ? 'no price data' : `${x.priceData.prefix} ${formatCurrency(x.priceData.price, { minFraction: 2, maxFraction: 8 })}`}&nbsp;
  {!x.priceData.volume24h ? null : priceDirection(x.priceData.flag)}
          </div>
          <div className="volume">
            {!x.priceData.volume24h ? 'no volume data' : `Vol: ${x.priceData.prefix}${formatCurrency(x.priceData.volume24h)}`}
          </div>
          {this.state.selectedBox === x.priceData.from + x.priceData.exchange
            ? <div className={"tick"}><i className="fas fa-check" /></div>
            : null}
        </div>)
    })

    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-signal" /> Dashboard</span>
                <div className="settings" onClick={() => this.handlePageUpdate('settings')}>
                  <i style={iconColor} className="fas fa-cog" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              {currencyList.length == 0 ? <center><h2> Empty List, add some pairs! </h2></center> : null}
              {currencyList.length > 6 ? <Scrollbars autoHeight autoHide autoHeightMin={340}>
                <div className="row">
                  {currencyList}
                </div>
              </Scrollbars> :
                <div className="row">
                  {currencyList}
                </div>}
            </div>
            {footer}
          </div>
        </div>
      </div>
    )
  }

  renderOfflinePage(footer) {
    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-signal" /> Dashboard</span>
                <div className="settings" onClick={() => this.handlePageUpdate('settings')}>
                  <i style={iconColor} className="fas fa-cog" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              <center>
                <i style={iconColor} className="fas fa-frown" /><h2> No internet Connection </h2>
              </center>
            </div>
            {footer}
          </div>
        </div>
      </div>
    )
  }

  renderLoadingPage(footer) {
    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-signal" /> Dashboard</span>
                <div className="settings" onClick={() => this.handlePageUpdate('settings')}>
                  <i style={iconColor} className="fas fa-cog" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              <br />
              <center><Circle size={20} color="#675BC0" /><h2> Fetching data </h2></center>
            </div>
            {footer}
          </div>
        </div>
      </div>
    )
  }

  renderSettingsPage(footer) {
    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-cog" /> Settings</span>
                <div className="settings" onClick={() => this.handlePageUpdate('home')}>
                  <i style={iconColor} className="fas fa-arrow-circle-left" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              <div className="submenu-item submenuRow" onClick={() => this.handlePageUpdate('setting.currency')}>
                <span><i style={iconColor} className="fas fa-list-ul" /> Currencies </span>
              </div>
              <div className="submenu-item submenuRow" onClick={() => this.handlePageUpdate('setting.proxy')}>
                <span><i style={iconColor} className="fas fa-network-wired" /> Proxy </span>
              </div>
              <div className="submenu-item submenuRow" onClick={() => this.handlePageUpdate('setting.interval')}>
                <span><i style={iconColor} className="fas fa-clock" /> Price Refresh Interval </span>
              </div>
            </div>
          </div>
          {footer}
        </div>
      </div>)
  }

  renderCurrencySettingPage(footer) {
    let SubOptions = this.state.currentSettings.currencies.map((x, i) => {
      return (
        <div className="currencies-list" key={i}><div className="currencies-item">
          {x.from} &nbsp;
  <i style={{ color: '#C6CED4' }} className="fas fa-angle-right" />&nbsp;
  {x.exchange}
          <div className="erase" onClick={() => this.handlePairDelete(i)}>
            <i className="fas fa-minus-circle" />
          </div>
        </div></div>)
    })
    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-list-ul" /> Currencies</span>
                <div className="settings" onClick={() => this.handlePageUpdate('settings')}>
                  <i style={iconColor} className="fas fa-arrow-circle-left" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              <div>
                <div className="submenu-subtitle"><strong>Currently monitored pairs</strong></div>
                <Scrollbars autoHide autoHeight autoHeightMin={265}>
                  {SubOptions.length == 0 ? <div className="empty-list">The list is empty, add a pair below.</div> : SubOptions}
                </Scrollbars>
                <div onClick={() => this.handlePageUpdate('setting.currency.add')} className="add-pair">
                  <i className="fas fa-2x fa-plus-circle" />
                </div>
              </div>
            </div>
          </div>
          {footer}
        </div>
      </div>)
  }

  renderAddCurrencyPage(footer) {
    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-list-ul" /> Currencies</span>
                <div className="settings" onClick={() => this.handlePageUpdate('setting.currency')}>
                  <i style={iconColor} className="fas fa-arrow-circle-left" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              <div>
                <div className="submenu-subtitle"><strong>Add new pair</strong></div>
                <form onSubmit={this.handlePairAdd}>
                  <div className="submenuRow">
                    <VirtualizedSelect
                      required
                      name="Token"
                      style={{ width: '70px', margin: '2px' }}
                      value={this.state.pairDropdownFrom}
                      clearable={false}
                      scrollMenuIntoView={true}
                      placeholder="Token"
                      onChange={this.handlePairDropdownFrom}
                      options={config.tickers.map(x => { return { label: x.label, value: x.label } })}
                    />
                    <VirtualizedSelect
                      required
                      name="Source"
                      style={{ width: '90px', margin: '2px' }}
                      value={this.state.pairDropdownExchange}
                      clearable={false}
                      scrollMenuIntoView={false}
                      placeholder="Source"
                      onChange={this.handlePairDropdownExchange}
                      options={config.exchanges.map(exchange => { return { value: exchange, label: exchange } })}
                    />
                  </div>
                  <center>
                    <div className="button-inline">
                      <input className='button' type="submit" value="Add" />
                    </div>
                  </center>
                </form>
              </div>
            </div>
          </div>
          {footer}
        </div>
      </div>)
  }

  renderProxySettingPage(footer) {
    return (
      <div className="myarrow">
        <div className="page darwin">
          <div className="container">
            <div className="header">
              <div className="title"><h1>
                <span className="main-title"><i style={iconColor} className="fas fa-network-wired" /> Proxy</span>
                <div className="settings" onClick={() => this.handlePageUpdate('settings')}>
                  <i style={iconColor} className="fas fa-arrow-circle-left" />
                </div>
              </h1></div>
            </div>
            <div className="inside">
              <div>
                <div className="submenu-subtitle"><strong>Proxy Setting</strong></div>
                <form onSubmit={this.handleProxySetting}>
                  <label>
                    Enable: <input name="enableProxy" type="checkbox" checked={this.state.enableProxy} onChange={this.handleProxyFormChange} />
                  </label>
                  <br />
                  <label>
                    Protocol: <input name="proxyProtocol" type="text" value={this.state.proxyProtocol} onChange={this.handleProxyFormChange} />
                  </label>
                  <br />
                  <label>
                    Server: <input name="proxyServer" type="text" value={this.state.proxyServer} onChange={this.handleProxyFormChange} />
                  </label>
                  <br />
                  <label>
                    Port: <input name="proxyPort" type="text" value={this.state.proxyPort} onChange={this.handleProxyFormChange} />
                  </label>
                  <br />
                  <center>
                    <div className="button-inline">
                      <input className='button' type="submit" value="Save" />
                    </div>
                  </center>
                </form>
              </div>
            </div>
          </div>
          {footer}
        </div>
      </div>)
  }

  renderIntervalSettingPage(footer) {
    return (
        <div className="myarrow">
          <div className="page darwin">
            <div className="container">
              <div className="header">
                <div className="title"><h1>
                  <span className="main-title"><i style={iconColor} className="fas fa-clock" /> Price Refresh Interval</span>
                  <div className="settings" onClick={() => this.handlePageUpdate('settings')}>
                    <i style={iconColor} className="fas fa-arrow-circle-left" />
                  </div>
                </h1></div>
              </div>
              <div className="inside">
                <div>
                  <div className="submenu-subtitle"><strong>Price Refresh Interval</strong></div>
                  <form onSubmit={this.handleIntervalSetting}>
                  <label>
                    Port: <input name="refreshInterval" type="text" value={this.state.refreshInterval} onChange={this.handleIntervalFormChange} /> seconds
                  </label>
                    <center>
                      <div className="button-inline">
                        <input className='button' type="submit" value="Save" />
                      </div>
                    </center>
                  </form>
                </div>
              </div>
            </div>
            {footer}
          </div>
        </div>)
  }

  render() {
    let Footer = (<div className="footer">
      <h2><a onClick={() => this.handleOpen('https://github.com/zimpha/crypto-bar')}>Crypto Bar </a>
        <span className="version">{this.state.version}</span>
        {this.state.updateAvailable ?
          <span>&nbsp;(Restart to Update)</span> : null}
      </h2>
    </div>)

    if (this.state.internetOffline) {
      return this.renderOfflinePage(Footer)
    }

    if (this.state.loading) {
      return this.renderLoadingPage(Footer)
    }

    // Price direction icon
    if (this.state.page === 'home') {
      return this.renderHomePage(Footer)
    }

    if (this.state.page === 'settings') {
      return this.renderSettingsPage(Footer)
    }

    if (this.state.page == "setting.currency") {
      return this.renderCurrencySettingPage(Footer)
    }

    if (this.state.page == "setting.currency.add") {
      return this.renderAddCurrencyPage(Footer)
    }

    if (this.state.page == "setting.proxy") {
      return this.renderProxySettingPage(Footer)
    }

    if (this.state.page == "setting.interval") {
        return this.renderIntervalSettingPage(Footer)
      }
  }
}
