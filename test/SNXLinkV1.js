const SNXLinkV1 = artifacts.require("SNXLinkV1");
const MultiSigWalletWithDailyLimitFactory = artifacts.require("MultiSigWalletWithDailyLimitFactory");
const MultiSigWalletWithDailyLimit = artifacts.require("MultiSigWalletWithDailyLimit");
const MockFeePool = artifacts.require("MockFeePool");
const MockDelegateApprovals = artifacts.require("MockDelegateApprovals");

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const bnChai = require('bn-chai')

const truffleAssert = require('truffle-assertions')

chai.use(chaiAsPromised)
chai.use(bnChai(web3.utils.BN))
const { expect } = chai
const BN = web3.utils.toBN

const prepareContracts = async (
    feeCollector,
    platformFee,
    claimerFee,
    gasOffsetCorrection
  ) => {
    const multiSigWalletWithDailyLimitFactory = await MultiSigWalletWithDailyLimitFactory.new()
    const mockFeePool = await MockFeePool.new()
    const mockDelegateApprovals = await MockDelegateApprovals.new()

    const SNXLinkV1Instance = await SNXLinkV1.new(
        multiSigWalletWithDailyLimitFactory.address,
        mockFeePool.address,
        mockDelegateApprovals.address,
        feeCollector,
        platformFee,
        claimerFee,
        gasOffsetCorrection
    )

    return {
      multiSigWalletWithDailyLimitFactory,
      mockFeePool,
      mockDelegateApprovals,
      SNXLinkV1Instance,
    }
}

contract('SNXLinkV1', (accounts) => {
  const feeCollector = accounts[1]
  const gasOffsetCorrection = new BN('220000')
  const platformFee = new BN(web3.utils.toWei('0.0005'))
  const claimerFee = new BN(web3.utils.toWei('0.0010'))

  let multiSigWalletWithDailyLimitFactory
  let mockFeePool
  let mockDelegateApprovals
  let SNXLinkV1Instance

  beforeEach(async () => {
    const contracts = await prepareContracts(feeCollector, platformFee, claimerFee, gasOffsetCorrection)
    multiSigWalletWithDailyLimitFactory = contracts.multiSigWalletWithDailyLimitFactory
    mockFeePool = contracts.mockFeePool
    mockDelegateApprovals = contracts.mockDelegateApprovals
    SNXLinkV1Instance = contracts.SNXLinkV1Instance
  })

  it('Should create an account with correct settings', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    expect(await SNXLinkV1Instance.isRegistered(user)).to.be.false

    await SNXLinkV1Instance
          .register(
              maxGasPrice,
              maxFeePerClaim,
              {
                from: user,
                value,
              }
          )

    expect(await SNXLinkV1Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV1Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN(value)

    expect(await(SNXLinkV1Instance.userMaxGasPrices(user))).to.eq.BN(maxGasPrice)
    expect(await(SNXLinkV1Instance.userMaxFeePerClaim(user))).to.eq.BN(maxFeePerClaim)
    expect(await(SNXLinkV1Instance.userAutoClaimDisabled(user))).to.be.false

    expect(await(SNXLinkV1Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV1Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV1Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should refund the tx cost plus the claimer fee and give to the platform', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV1Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV1Instance.address, true)

    const claimer = accounts[4]
    const claimerInitialBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorInitialBalance = new BN(await web3.eth.getBalance(feeCollector))

    const userFeeWallet = await SNXLinkV1Instance.userFeeWallets(user)
    const userFeeWalletInitialBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    const fee = new BN(web3.utils.toWei("10"));
    const reward = new BN(web3.utils.toWei("20"));
    await mockFeePool.setFeesAvailable(user, fee, reward);

    await SNXLinkV1Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    })

    const claimerFinalBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorFinalBalance = new BN(await web3.eth.getBalance(feeCollector))
    const userFeeWalletFinalBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    expect(userFeeWalletInitialBalance.sub(userFeeWalletFinalBalance)).to.be.lt.BN(maxFeePerClaim)
    expect(feeCollectorFinalBalance.sub(feeCollectorInitialBalance)).to.be.eq.BN(platformFee)
    expect(claimerFinalBalance.sub(claimerInitialBalance)).to.be.gt.BN(claimerFee)

    expect(await SNXLinkV1Instance.totalFeesClaimed()).to.be.eq.BN(fee)
    expect(await SNXLinkV1Instance.totalRewardsClaimed()).to.be.eq.BN(reward)
  })

  it('Should fail if gasPrice higher than configured', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV1Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV1Instance.address, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV1Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("5", "gwei"))
    }), 'Gas Price higher than user configured')

  })

  it('Should fail if totalCost higher than configured', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.0003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV1Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV1Instance.address, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV1Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Total cost higher than user configured')
  })

  it('Should fail if claimOnBehalf fails', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV1Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV1Instance.address, true)
    await mockFeePool.setFailClaim(true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV1Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Failed to ClaimOnBehalf')
  })

  it('Should fail if disabled by user', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV1Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV1Instance.address, true)

    await SNXLinkV1Instance.disable({from: user})

    expect(await(SNXLinkV1Instance.disabledUsersCount())).to.be.eq.BN(1)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV1Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'User disabled auto-claim')
  })
});
