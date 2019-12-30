 /**************************
 * 投资类 描述了 指定策略下的投资过程
 * 投资快照类 描述了投资过程中，某一天的状态
 **************************/

import { FundJson, FundDataItem } from "../../../tools/get-fund-data-json"
import { dateFormat, roundToFix } from "../common"
// import FundDataJson from './static/景顺长城新兴成长混合260108.json'
const ONE_DAY = 24 * 60 * 60 * 1000

interface FundTransaction {
  /** 
   * 份额 
   * */
  portion: number 
  /** 
   * 基金净值
   * */
  val: number 
  /** 
   * 金额
   * */
  amount: number
}

/**
 * 基金的长期投资计划
 */
export class InvestmentStrategy {
  totalAmount!: number // 初始资本，存量
  salary!: number // 工资，每月增量资金
  
  fixedInvestment!: {
    amount: number // 每次定投金额
    dateOrWeek: number // 每周周几，每月几号定投
    period: 'weekly' | 'monthly'   // 每周，每月，每 2 周定投
  } // 定投周期

  /**
   * 当前投资的状态
   */
  latestInvestment!: InvestDateSnapshot

  fundJson!: FundJson // 基金源数据
  
  buyFeeRate: number = 0.0015 // 买入的手续费， 一般是 0.15%
  sellFeeRate: number = 0.005 // 卖出的手续费， 一般是 0.5%
  
  // 止盈点， 
  stop!: {
    rate: number  // 基金涨了 5 % 就止盈一部分
    minAmount: number // 止盈的最低 持仓临界线，如低于 10% 
  }

  // 做 T 时的配置信息
  tInvest!: {
    rate: number // 自上次止盈后， 降幅 rate 幅度后 做 T
    amount: number // 补仓 份额 （买）
  }

  /**
   * 该基金策略下运行的每个交易日的数据
   */
  data: InvestDateSnapshot[] = []

  // range!: [string| Date, string| Date]

  constructor(options: Pick<InvestmentStrategy, 'fixedInvestment'|'fundJson'|'salary'|'stop'|'tInvest'|'totalAmount'>) {
    Object.assign(this, options)

    
    
  }

  /**
   * 策略定投
   */
  fixedInvest(range: [string| Date, string| Date]) {
    // 定投策略
    const beginTime = new Date(range[0]).getTime()
    const endTime = new Date(range[1]).getTime()
    let tempDate = beginTime

    while(tempDate <= endTime) {
      const dateStr = dateFormat(tempDate)
      if(!this.data || this.data.length === 0) {
        let beginFundData: FundDataItem = this.getFundByDate(dateStr)  

        this.data.push(new InvestDateSnapshot({
          fundStrategy: this,
          cost: beginFundData.val,
          portion: 0,
          date: dateStr,
          leftAmount: this.totalAmount,
        }))
      } else {
      // const len = this.data.length
      // let curFundData: FundDataItem = this.fundJson.all[ dateFormat(tempDate) ]

      this.data.push(new InvestDateSnapshot({
        fundStrategy: this,
        // cost: curFundData.val,
        // portion: 0,
        date: dateStr,
        // leftAmount: this.totalAmount,
      }))
      }
      
      tempDate += 24 * 60 * 60 * 1000
    }
  }

  /**
   * 买入基金
   */
  buy(amount: number, date: any) {
    const dateStr = dateFormat(date)
    let cur = new Date(date).getTime()

    // 填充起始时间和 终止时间之间的空白数据
    if(this.latestInvestment) {
      let latestInvestDate = new Date(this.latestInvestment.date).getTime()
      latestInvestDate += ONE_DAY
      while(cur > latestInvestDate) {
        const invest = new InvestDateSnapshot({
          fundStrategy: this,
          date: dateFormat(latestInvestDate)
        }).buy(0)
        // console.log('date', invest.date, invest)

        this.data.push(invest)
        latestInvestDate += ONE_DAY
      }
    }  
    const invest = new InvestDateSnapshot({
      fundStrategy: this,
      date: dateStr
    }).buy(amount)

    this.data.push(invest)
    return this
  }

  sell(amount:number|'all', date: any) {
    const dateStr = dateFormat(date)
    let cur = new Date(date).getTime()

    // 填充起始时间和 终止时间之间的空白数据
    if(this.latestInvestment) {
      let latestInvestDate = new Date(this.latestInvestment.date).getTime()
      latestInvestDate += ONE_DAY
      while(cur > latestInvestDate) {
        const invest = new InvestDateSnapshot({
          fundStrategy: this,
          date: dateFormat(latestInvestDate)
        }).sell({amount: 0})

        this.data.push(invest)
        latestInvestDate += ONE_DAY
      }
    }  
    const invest = new InvestDateSnapshot({
      fundStrategy: this,
      date: dateStr
    })
    if(amount === 'all') {
      invest.sell('all')
    } else {
      invest.sell({amount})
    }

    this.data.push(invest)
    return this
  }

  /**
   * 根据日期获取对应的基金信息
   */
  getFundByDate(date: string): FundDataItem {
    const result = this.fundJson.all[  date ]
    // 如果没有 result， 说明那一天是 非交易日，往更早的日期取值
    if(!result) {
      const previewValidDate = dateFormat( new Date(date).getTime() - 24 * 60 * 60 * 1000)
      return this.getFundByDate(previewValidDate)
    } else {
      return result
    }
    
  }
}

/**
 * 投资周期中，某一天的持仓快照
 */
export class InvestDateSnapshot {
  /**
   * 基金投资策略
   */
  fundStrategy: InvestmentStrategy 

  /** 
   * 持仓成本 单价
   * */ 
  cost!: number // 每天操作后计算赋值
   

  /**
   * 持仓成本金额
   */
  get costAmount():number {
    return roundToFix( this.cost * this.portion, 2 )
  }

  /** 
   * 持仓份额  
   * */
  portion!:number // 每天操作后计算赋值
   

  /**
   * 持仓金额 = 当前净值 * 持有份额
   */
  get fundAmount():number {
    return roundToFix( this.curFund.val * this.portion, 2)
  } 

  /** 
   * 持有收益 = （当前净值 - 持有成本）* 持仓份额  
   * */
  get profit():number {
    return roundToFix((this.curFund.val - this.cost) * this.portion, 2)
  } 
  /** 
   * 持有收益率 = （当前净值 / 成本价）- 1 
   * */
  get profitRate():number {
    if(this.cost === 0) {
      return 0
    }
    return roundToFix( this.curFund.val / this.cost - 1, 4 ) 
  }

  /**
   * 赎回了的收益
   */
  returnedProfit!: number

  /**
   * 总共买入的金额 
   * 需要手动赋值初始化
   */
  totalBuyAmount!: number

  /**
   * 总共卖出的金额 
   * 需要手动赋值初始化
   */
  totalSellAmount!: number

  /**
   * 累计收益
   */
  get totalProfit() {
    return this.returnedProfit + this.profit
  }

  /**
   * 累计成本， 用于算累计收益率 https://sspai.com/post/53061
   */

  /**
   * 资金弹药，还剩下多少钱可以加仓，可用资金
   * = 上一个交易日的 leftAmount + (今日加减仓)
   */
  leftAmount!:number 
  
  /**
   * 总资产 = 资金弹药 +  持仓金额
   */
  get totalAmount(): number  {
    return roundToFix( this.leftAmount + this.fundAmount , 2)
  }

  /**
   * 累计收益
   */
  get accumulatedProfit() {
    return roundToFix( this.fundAmount - this.totalBuyAmount + this.totalSellAmount, 2)
  }


  
  date: string // 当前日期

  get shouldFixedInvest():boolean {
    const now = new Date(this.date)
    const fixedInvestment = this.fundStrategy.fixedInvestment
    if(fixedInvestment.period === 'monthly') {
      return now.getDate() === fixedInvestment.dateOrWeek
    } else if(fixedInvestment.period === 'weekly') {
      return now.getDay() === fixedInvestment.dateOrWeek
    } else {
      return false 
    }
  }

  /**
   * 当前基金数据
   */
  curFund: FundDataItem 

  /**
   * 基金在区间内的涨幅
   */
  get fundGrowthRate():number {
    if(this.fundStrategy.data[0]) {
      // 起始基金净值
      const firstFundVal = this.fundStrategy.data[0].curFund.val
      return roundToFix((this.curFund.val - firstFundVal) / firstFundVal, 4)
    } else {
      return 0
    }
  }

  /**
   * 当天买入 金额（不计手续费）
   */
  dateBuyAmount: number = 0
  /**
   * 当天卖出的金额
   */
  dateSellAmount: number = 0
  fixedBuy!: FundTransaction|null// 被动定投买入份额，金额。 金额 = 份额 * 基金净值
  profitSell!: FundTransaction|null // 被动触发条件 卖出止盈的，份额，金额，
  buyWhenDecline!: FundTransaction|null // 主动补仓买入份额，金额
  sellWhenRise!: FundTransaction|null // 卖出补仓做 T 的份额，金额，

  /**
   * @param options 
   */
  constructor(options: Partial<Pick<InvestDateSnapshot, 'date'|'fundStrategy'|'cost'|'leftAmount'|'portion'>>) {
    
    
    // 每天的操作，只需要手动更新：date, cost，portion, leftAmount
    this.date = options.date ? dateFormat(options.date) : dateFormat(Date.now())
    this.fundStrategy = options.fundStrategy!
    this.curFund = this.fundStrategy.getFundByDate(this.date)
    if(!this.fundStrategy.latestInvestment) {
      this.portion = 0
      this.cost = 0
      this.returnedProfit = 0
      this.totalBuyAmount = 0
      this.totalSellAmount = 0
      this.leftAmount = this.fundStrategy.totalAmount
    } else {
      const latestInvestment = this.fundStrategy.latestInvestment
      this.portion = latestInvestment.portion
      this.cost = latestInvestment.cost
      this.leftAmount = latestInvestment.leftAmount
      this.totalBuyAmount = latestInvestment.totalBuyAmount
      this.totalSellAmount = latestInvestment.totalSellAmount
      this.returnedProfit = latestInvestment.returnedProfit
    }

    this.operate()
  }

  /**
   * 该日期基金操作行为
   */
  operate() {
    this.income()
    // TODO: 
    // 分红日？重新计算 成本和 份额。【分红后，收益不变，净值变低。 所以 持仓成本 = 分红后净值/ （profitRate+1）】【份额 = fundAmount / 分红后净值】
    
    // 定投日? 买入定投金额
    // if(this.shouldFixedInvest) {
    //   this.buy(this.fundStrategy.fixedInvestment.amount)
    // }
    
    // TODO: 触发补仓？

    // TODO: 触发止盈？

    // TODO: 触发卖出补仓份额？

    

    // 剩余资金小于 0， 即为爆仓
    // if(this.fundAmount < 0) {
  
    // }

    this.fundStrategy.latestInvestment = this
    
  }

  /**
   * 发工资，增加可用资金
   */
  private income() {
    // const latestInvestment = this.fundStrategy.latestInvestment
    // const latestInvestmentAmount = latestInvestment ? latestInvestment.leftAmount : 0
    const salaryDate = 1
    // 发薪日
    if(new Date(this.date).getDate() === salaryDate) {
      
      this.leftAmount +=  this.fundStrategy.salary
    }  
  }
  
  /**
   * 填充满买入时交易相关数据
   * @param txn 交易数据
   */
  private fulfillBuyTxn(txn:Partial<FundTransaction>): FundTransaction{
    txn.val = txn.val || this.curFund.val
    if( !isNaN(txn.amount!) && !txn.portion) {
      // 除去买入费率的 净申购金额 (参考 支付宝基金买入申购计算)
      txn.amount = roundToFix( txn.amount! / (1 + this.fundStrategy.buyFeeRate), 2 )
      txn.portion = roundToFix(txn.amount / txn.val, 2)
    }
 
    return txn as FundTransaction
  }

  /**
   * 填充满卖出时交易相关数据
   * @param txn 交易数据
   */
  private fulfillSellTxn(txn:Partial<FundTransaction>): FundTransaction{
    txn.val = txn.val || this.curFund.val
    let portion:number 
    // 卖出只能用份额计算
    // 如果是卖出 指定 amount，转换成份额
    if((txn.amount || txn.amount === 0) && !txn.portion) {
      portion = roundToFix(txn.amount / txn.val, 2)
    } else if(isNaN(txn.amount!) && txn.portion) {
      // 如果是卖出指定 份额
      portion = txn.portion
    } else {
      throw new Error('txn.portion 和 txn.amount 必须有且只有一个值')
    }
    txn.portion = portion

    // 卖出的真实 到账金额
    txn.amount = txn.val * portion * (1 - this.fundStrategy.sellFeeRate)
 
    return txn as FundTransaction
  }
 
  /**
   * 买入基金行为，买入金额
   * @param amount 金额
   */
  buy(amount:number) {
    // amount 是掏出的钱
    // buyTxn.amount 是除去 手续费后，确切买入基金的金额， 两者差价为买入手续费
    // if(amount > 0) {
    //   debugger
    // }
    if(amount <= 0) {
      return this
    }
    this.totalBuyAmount += amount
    this.dateBuyAmount += amount

    const buyTxn = this.fulfillBuyTxn({
      amount
    })
    // 上一次快照
    const latestInvestment = this.fundStrategy.data[this.fundStrategy.data.length - 1]  || {
      portion : 0,
      cost: 0,
      costAmount: 0,
      leftAmount: this.fundStrategy.totalAmount
    }
    // 最新份额 = 上一次的 份额，加最新买入的份额
    this.portion = latestInvestment.portion + buyTxn.portion

    // 买入行为后，持仓成本 = (之前持仓成本金额 + 买入金额) / 基金总份额
    this.cost = roundToFix( (latestInvestment.costAmount + amount)  / this.portion , 4)

    // 买入后从剩余资金扣除
    this.leftAmount = latestInvestment.leftAmount - amount
    
    return this
  }
  /**
   * 卖出基金
   * @param txn 卖出信息
   */
  sell(txn:Partial<FundTransaction>|'all') {
    
    // 上一次快照， 
    const latestInvestment = this.fundStrategy.data[this.fundStrategy.data.length - 1]  || {
      portion : 0,
      cost: 0,
      costAmount: 0,
      leftAmount: this.fundStrategy.totalAmount
    }

    if(txn === 'all') {
      txn = {
        portion: latestInvestment.portion
      }
    }

    if(txn && (txn.amount! <= 0 || txn.portion! <= 0)) {
      return this
    }
    const sellTxn = this.fulfillSellTxn(txn)
    // 此时的 this.fundStrategy.latestInvestment 其实就是 this, 因为 sell() 执行前， latestInvestment 就已经被赋值了
    

    // 最新份额 = 上一次的 份额 - 最新卖出的份额
    this.portion = latestInvestment.portion - sellTxn.portion
    if(this.portion < 0) {
      throw new TypeError('卖出份额不能比持有份额高')
    }

    // 卖出行为后，持仓成本 = (之前持仓成本金额 - 卖出金额) / 基金总份额
    // this.cost = (latestInvestment.costAmount - sellTxn.amount)  / this.portion
    this.cost = latestInvestment.cost
    // 算法参考 https://www.zhihu.com/question/265056524
    this.returnedProfit = latestInvestment.returnedProfit +  sellTxn.amount / (1/this.profitRate + 1)

    // 卖出后加到 剩余资产中
    this.leftAmount = roundToFix( latestInvestment.leftAmount + sellTxn.amount, 2 )
    
    this.totalSellAmount = roundToFix( this.totalSellAmount + sellTxn.amount, 2)
    this.dateSellAmount = roundToFix(this.dateSellAmount + sellTxn.amount, 2) 

    return this
  }

}

// TODO: 某个时间点到某个时间点之间的 涨幅比较
// 普通场景 涨幅： Tb / Ta - 1 
// 中间存在 分红点： Tb / fh * (fh + 派送金额) / Ta - 1 


// const ist = new InvestmentStrategy({
//   // fundJson: FundDataJson as FundJson,
//   range: ['2018-01-01', '2019-12-01'],
//   totalAmount: 100000,
//   salary: 10000,
//   fixedInvestment: {
//     amount: 300,
//     period: 'weekly',
//     dateOrWeek: 4,
//   },
//   // buyFeeRate: 0.0015,
//   // sellFeeRate: 0.005,
//   stop: {
//     rate: 0.05,
//     minAmount: 50000,
//   },

//   tInvest: {
//     rate: 0.05,
//     amount: 1000
//   },
//   fundJson: FundDataJson as any as FundJson
// })

// console.log('ist', ist)
