const SNXLinkV1 = artifacts.require("SNXLinkV1");
const SNXLinkV2 = artifacts.require("SNXLinkV2");
const MultiSigWalletWithDailyLimitFactory = artifacts.require("MultiSigWalletWithDailyLimitFactory");
const MultiSigWalletWithDailyLimit = artifacts.require("MultiSigWalletWithDailyLimit");
const MockFeePool = artifacts.require("MockFeePool");
const MockDelegateApprovals = artifacts.require("MockDelegateApprovals");
const MockSynthetix = artifacts.require("MockSynthetix");
const MockSynthetixState = artifacts.require("MockSynthetixState");

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
    platformFeeGuaranteed,
    claimerFee,
    claimerFeeGuaranteed,
    gasOffsetCorrection
  ) => {
    const multiSigWalletWithDailyLimitFactory = await MultiSigWalletWithDailyLimitFactory.new()
    const mockFeePool = await MockFeePool.new()
    const mockDelegateApprovals = await MockDelegateApprovals.new()
    const mockSynthetix = await MockSynthetix.new()
    const mockSynthetixState = await MockSynthetixState.new()
    await mockSynthetixState.setIssuanceRatio('125000000000000000')

    const SNXLinkV1Instance = await SNXLinkV1.new(
      multiSigWalletWithDailyLimitFactory.address,
      mockFeePool.address,
      mockDelegateApprovals.address,
      feeCollector,
      platformFee,
      claimerFee,
      gasOffsetCorrection
    )

    const SNXLinkV2Instance = await SNXLinkV2.new(
          multiSigWalletWithDailyLimitFactory.address,
          mockFeePool.address,
          mockDelegateApprovals.address,
          mockSynthetix.address,
          mockSynthetixState.address,
          feeCollector,
          SNXLinkV1Instance.address,
          platformFee,
          platformFeeGuaranteed,
          claimerFee,
          claimerFeeGuaranteed,
          gasOffsetCorrection,
      )

    return {
      multiSigWalletWithDailyLimitFactory,
      mockFeePool,
      mockDelegateApprovals,
      mockSynthetix,
      mockSynthetixState,
      SNXLinkV1Instance,
      SNXLinkV2Instance,
    }
}

contract('SNXLinkV2', (accounts) => {
  const feeCollector = accounts[1]
  const gasOffsetCorrection = new BN('280000')
  const platformFee = new BN(web3.utils.toWei('0.0005'))
  const platformFeeGuaranteed = new BN(web3.utils.toWei('0.0010'))
  const claimerFee = new BN(web3.utils.toWei('0.0010'))
  const claimerFeeGuaranteed = new BN(web3.utils.toWei('0.0020'))

  let multiSigWalletWithDailyLimitFactory
  let mockFeePool
  let mockDelegateApprovals
  let mockSynthetix
  let mockSynthetixState
  let SNXLinkV1Instance
  let SNXLinkV2Instance

  beforeEach(async () => {
    const contracts = await prepareContracts(feeCollector, platformFee, platformFeeGuaranteed, claimerFee, claimerFeeGuaranteed, gasOffsetCorrection)
    multiSigWalletWithDailyLimitFactory = contracts.multiSigWalletWithDailyLimitFactory
    mockFeePool = contracts.mockFeePool
    mockDelegateApprovals = contracts.mockDelegateApprovals
    mockSynthetix = contracts.mockSynthetix
    mockSynthetixState = contracts.mockSynthetixState
    SNXLinkV1Instance = contracts.SNXLinkV1Instance
    SNXLinkV2Instance = contracts.SNXLinkV2Instance
  })

  it('Should create an account with correct settings', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.false

    await SNXLinkV2Instance
          .register(
              maxGasPrice,
              maxFeePerClaim,
              true,
              {
                from: user,
                value,
              }
          )

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN(value)

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(maxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(maxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.false
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.true

    expect(await(SNXLinkV2Instance.previousVersion())).to.be.eq.string(SNXLinkV1Instance.address)

    expect(await(SNXLinkV2Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV2Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should refund the tx cost plus the claimer fee and give to the platform', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            true,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)

    const claimer = accounts[4]
    const claimerInitialBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorInitialBalance = new BN(await web3.eth.getBalance(feeCollector))

    const userFeeWallet = await SNXLinkV2Instance.userFeeWallets(user)
    const userFeeWalletInitialBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    const fee = new BN(web3.utils.toWei("10"));
    const reward = new BN(web3.utils.toWei("20"));
    await mockFeePool.setFeesAvailable(user, fee, reward);

    await SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    })

    const claimerFinalBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorFinalBalance = new BN(await web3.eth.getBalance(feeCollector))
    const userFeeWalletFinalBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    expect(userFeeWalletInitialBalance.sub(userFeeWalletFinalBalance)).to.be.lt.BN(maxFeePerClaim)
    expect(feeCollectorFinalBalance.sub(feeCollectorInitialBalance)).to.be.eq.BN(platformFee)
    expect(claimerFinalBalance.sub(claimerInitialBalance)).to.be.gt.BN(claimerFee)

    expect(await SNXLinkV2Instance.totalFeesClaimed()).to.be.eq.BN(fee)
    expect(await SNXLinkV2Instance.totalRewardsClaimed()).to.be.eq.BN(reward)
  })

  it('Should fail if gasPrice higher than configured', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            true,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("5", "gwei"))
    }), 'Gas Price higher than user configured')

  })

  it('Should fail if totalCost higher than configured', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.0003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            true,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Total cost higher than user configured')
  })

  it('Should fail if claimOnBehalf fails', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            true,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockFeePool.setFailClaim(true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Failed to ClaimOnBehalf')
  })

  it('Should fail if disabled by user', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
        .register(
            maxGasPrice,
            maxFeePerClaim,
            true,
            {
              from: user,
              value,
            }
        )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)

    await SNXLinkV2Instance.disable({from: user})

    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(1)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'User disabled auto-claim')
  })

  it('Should create an account with correct settings', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.false

    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN(value)

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(maxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(maxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.false
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.false

    expect(await(SNXLinkV2Instance.previousVersion())).to.be.eq.string(SNXLinkV1Instance.address)

    expect(await(SNXLinkV2Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV2Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should refund the tx cost plus the claimer fee and give to the platform when c-ratio > system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '120000000000000000')

    const claimer = accounts[4]
    const claimerInitialBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorInitialBalance = new BN(await web3.eth.getBalance(feeCollector))

    const userFeeWallet = await SNXLinkV2Instance.userFeeWallets(user)
    const userFeeWalletInitialBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    const fee = new BN(web3.utils.toWei("10"));
    const reward = new BN(web3.utils.toWei("20"));
    await mockFeePool.setFeesAvailable(user, fee, reward);

    const preBurned = new BN(await mockSynthetix.burned())

    await SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    })

    const postBurned = new BN(await mockSynthetix.burned())

    const claimerFinalBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorFinalBalance = new BN(await web3.eth.getBalance(feeCollector))
    const userFeeWalletFinalBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    expect(userFeeWalletInitialBalance.sub(userFeeWalletFinalBalance)).to.be.lt.BN(maxFeePerClaim)
    expect(feeCollectorFinalBalance.sub(feeCollectorInitialBalance)).to.be.eq.BN(platformFee)
    expect(claimerFinalBalance.sub(claimerInitialBalance)).to.be.gt.BN(claimerFee)

    expect(await SNXLinkV2Instance.totalFeesClaimed()).to.be.eq.BN(fee)
    expect(await SNXLinkV2Instance.totalRewardsClaimed()).to.be.eq.BN(reward)
    expect(postBurned.sub(preBurned)).to.be.eq.BN(new BN(0))
  })

  it('Should refund the tx cost plus the claimer fee and give to the platform when c-ratio = system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '125000000000000000')

    const claimer = accounts[4]
    const claimerInitialBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorInitialBalance = new BN(await web3.eth.getBalance(feeCollector))

    const userFeeWallet = await SNXLinkV2Instance.userFeeWallets(user)
    const userFeeWalletInitialBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    const fee = new BN(web3.utils.toWei("10"));
    const reward = new BN(web3.utils.toWei("20"));
    await mockFeePool.setFeesAvailable(user, fee, reward);

    const preBurned = new BN(await mockSynthetix.burned())

    await SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    })

    const postBurned = new BN(await mockSynthetix.burned())

    const claimerFinalBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorFinalBalance = new BN(await web3.eth.getBalance(feeCollector))
    const userFeeWalletFinalBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    expect(userFeeWalletInitialBalance.sub(userFeeWalletFinalBalance)).to.be.lt.BN(maxFeePerClaim)
    expect(feeCollectorFinalBalance.sub(feeCollectorInitialBalance)).to.be.eq.BN(platformFee)
    expect(claimerFinalBalance.sub(claimerInitialBalance)).to.be.gt.BN(claimerFee)

    expect(await SNXLinkV2Instance.totalFeesClaimed()).to.be.eq.BN(fee)
    expect(await SNXLinkV2Instance.totalRewardsClaimed()).to.be.eq.BN(reward)
    expect(postBurned.sub(preBurned)).to.be.eq.BN(new BN(0))
  })

  it('Should refund the tx cost plus the claimer fee and give to the platform when c-ratio < system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.007"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockDelegateApprovals.setApprovalBurn(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]
    const claimerInitialBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorInitialBalance = new BN(await web3.eth.getBalance(feeCollector))

    const userFeeWallet = await SNXLinkV2Instance.userFeeWallets(user)
    const userFeeWalletInitialBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    const fee = new BN(web3.utils.toWei("10"));
    const reward = new BN(web3.utils.toWei("20"));
    await mockFeePool.setFeesAvailable(user, fee, reward);

    const preBurned = new BN(await mockSynthetix.burned())

    await SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    })

    const postBurned = new BN(await mockSynthetix.burned())

    const claimerFinalBalance = new BN(await web3.eth.getBalance(claimer))
    const feeCollectorFinalBalance = new BN(await web3.eth.getBalance(feeCollector))
    const userFeeWalletFinalBalance = new BN(await web3.eth.getBalance(userFeeWallet))

    expect(userFeeWalletInitialBalance.sub(userFeeWalletFinalBalance)).to.be.lt.BN(maxFeePerClaim)
    expect(feeCollectorFinalBalance.sub(feeCollectorInitialBalance)).to.be.eq.BN(platformFeeGuaranteed)
    expect(claimerFinalBalance.sub(claimerInitialBalance)).to.be.gt.BN(claimerFeeGuaranteed)

    expect(await SNXLinkV2Instance.totalFeesClaimed()).to.be.eq.BN(fee)
    expect(await SNXLinkV2Instance.totalRewardsClaimed()).to.be.eq.BN(reward)
    expect(postBurned.sub(preBurned)).to.be.eq.BN(new BN(1))
  })

  it('Should fail if gasPrice higher than configured, guaranteed enabled and c-ratio > system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '115000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("5", "gwei"))
    }), 'Gas Price higher than user configured')

  })

  it('Should fail if gasPrice higher than configured, guaranteed enabled and c-rati = system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '125000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("5", "gwei"))
    }), 'Gas Price higher than user configured')

  })

  it('Should fail if gasPrice higher than configured, guaranteed enabled and c-ratio < system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.007"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("5", "gwei"))
    }), 'Gas Price higher than user configured')

  })

  it('Should fail if totalCost higher than configured, guaranteed enabled and c-ratio > system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.0003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '115000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Total cost higher than user configured')
  })

  it('Should fail if totalCost higher than configured, guaranteed enabled and c-ratio = system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.0003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '125000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Total cost higher than user configured')
  })

  it('Should fail if totalCost higher than configured, guaranteed enabled and c-ratio < system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.0003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Total cost higher than user configured')
  })

  it('Should fail if claimOnBehalf fails, guaranteed enabled and c-ratio > system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockFeePool.setFailClaim(true)
    await mockSynthetix.setCollateralisationRatio(user, '115000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Failed to ClaimOnBehalf')
  })

  it('Should fail if claimOnBehalf fails, guaranteed enabled and c-ratio = system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockFeePool.setFailClaim(true)
    await mockSynthetix.setCollateralisationRatio(user, '125000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Failed to ClaimOnBehalf')
  })

  it('Should fail if claimOnBehalf fails, guaranteed enabled and c-ratio < system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockFeePool.setFailClaim(true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'Failed to ClaimOnBehalf')
  })

  it('Should fail if disabled by user, guaranteed enabled and c-ratio > system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '115000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    await SNXLinkV2Instance.disable({from: user})

    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(1)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'User disabled auto-claim')
  })

  it('Should fail if disabled by user, guaranteed enabled and c-ratio = system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '125000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    await SNXLinkV2Instance.disable({from: user})

    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(1)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'User disabled auto-claim')
  })

  it('Should fail if disabled by user, guaranteed enabled and c-ratio < system', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, true)

    await SNXLinkV2Instance.disable({from: user})

    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(1)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), 'User disabled auto-claim')
  })

  it('Should fail if guaranteed enabled, c-ratio < system and burn fail', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, false)

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), '')
  })

  it('Should fail if guaranteed disabled, c-ratio < system and burn fail', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await mockDelegateApprovals.setApproval(user, SNXLinkV2Instance.address, true)
    await mockSynthetix.setCollateralisationRatio(user, '145000000000000000')
    await mockSynthetix.setAccountCanBurn(user, false)
    await mockFeePool.setFailClaim(true)

    await SNXLinkV2Instance.disableGuaranteedAutoClaim({from: user})

    const claimer = accounts[4]

    await truffleAssert.reverts(SNXLinkV2Instance.claimOnBehalf(user, {
      from: claimer,
      gasPrice: new BN(web3.utils.toWei("1", "gwei"))
    }), '')
  })

  it('Should set platform fees if they are lower than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    const newPlatformFee = platformFee.sub(new BN(web3.utils.toWei('0.0001')))
    await SNXLinkV2Instance.changeFees(
      newPlatformFee,
      claimerFee,
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection
    )

    expect(await(SNXLinkV2Instance.platformFee())).to.be.eq.BN(newPlatformFee)
    expect(await(SNXLinkV2Instance.claimerFee())).to.be.eq.BN(claimerFee)
    expect(await(SNXLinkV2Instance.platformFeeGuaranteed())).to.be.eq.BN(platformFeeGuaranteed)
    expect(await(SNXLinkV2Instance.claimerFeeGuaranteed())).to.be.eq.BN(claimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.gasOffsetCorrection())).to.be.eq.BN(gasOffsetCorrection)
  })

  it('Should set platform fees if they are equal than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection
    )

    expect(await(SNXLinkV2Instance.platformFee())).to.be.eq.BN(platformFee)
    expect(await(SNXLinkV2Instance.claimerFee())).to.be.eq.BN(claimerFee)
    expect(await(SNXLinkV2Instance.platformFeeGuaranteed())).to.be.eq.BN(platformFeeGuaranteed)
    expect(await(SNXLinkV2Instance.claimerFeeGuaranteed())).to.be.eq.BN(claimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.gasOffsetCorrection())).to.be.eq.BN(gasOffsetCorrection)
  })

  it('Should fail if platform fees greater than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await truffleAssert.reverts(SNXLinkV2Instance.changeFees(
      platformFee.add(new BN(web3.utils.toWei('0.0001'))),
      claimerFee,
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection
    ), 'Platform fee should be less than initial one set')
  })

  it('Should set claimer fees if they are lower than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    const newClaimerFeeGuaranteed = claimerFee.sub(new BN(web3.utils.toWei('0.0001')))
    await SNXLinkV2Instance.changeFees(
      platformFee,
      newClaimerFeeGuaranteed,
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection
    )

    expect(await(SNXLinkV2Instance.platformFee())).to.be.eq.BN(platformFee)
    expect(await(SNXLinkV2Instance.claimerFee())).to.be.eq.BN(newClaimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.platformFeeGuaranteed())).to.be.eq.BN(platformFeeGuaranteed)
    expect(await(SNXLinkV2Instance.claimerFeeGuaranteed())).to.be.eq.BN(claimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.gasOffsetCorrection())).to.be.eq.BN(gasOffsetCorrection)
  })

  it('Should fail if claimer fees greater than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await truffleAssert.reverts(SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee.add(new BN(web3.utils.toWei('0.0001'))),
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection
    ), 'Claimer fee should be less than initial one set')
  })

  it('Should set platform guaranteed fees if they are lower than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    const newPlatformFeeGuaranteed = platformFeeGuaranteed.sub(new BN(web3.utils.toWei('0.0001')))
    await SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      newPlatformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection
    )

    expect(await(SNXLinkV2Instance.platformFee())).to.be.eq.BN(platformFee)
    expect(await(SNXLinkV2Instance.claimerFee())).to.be.eq.BN(claimerFee)
    expect(await(SNXLinkV2Instance.platformFeeGuaranteed())).to.be.eq.BN(newPlatformFeeGuaranteed)
    expect(await(SNXLinkV2Instance.claimerFeeGuaranteed())).to.be.eq.BN(claimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.gasOffsetCorrection())).to.be.eq.BN(gasOffsetCorrection)
  })

  it('Should fail if platform guaranteed fees greated than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await truffleAssert.reverts(SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      platformFeeGuaranteed.add(new BN(web3.utils.toWei('0.0001'))),
      claimerFeeGuaranteed,
      gasOffsetCorrection
    ), 'Platform fee for Guaranteed AutoClaim should be less than initial one set')
  })

  it('Should set claimer guaranteed fees if they are lower than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    const newClaimerFeeGuaranteed = claimerFeeGuaranteed.sub(new BN(web3.utils.toWei('0.0001')))
    await SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      platformFeeGuaranteed,
      newClaimerFeeGuaranteed,
      gasOffsetCorrection
    )

    expect(await(SNXLinkV2Instance.platformFee())).to.be.eq.BN(platformFee)
    expect(await(SNXLinkV2Instance.claimerFee())).to.be.eq.BN(claimerFee)
    expect(await(SNXLinkV2Instance.platformFeeGuaranteed())).to.be.eq.BN(platformFeeGuaranteed)
    expect(await(SNXLinkV2Instance.claimerFeeGuaranteed())).to.be.eq.BN(newClaimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.gasOffsetCorrection())).to.be.eq.BN(gasOffsetCorrection)
  })

  it('Should fail if claimer guaranteed fees greated than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await truffleAssert.reverts(SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      platformFeeGuaranteed,
      claimerFeeGuaranteed.add(new BN(web3.utils.toWei('0.0001'))),
      gasOffsetCorrection
    ), 'Claimer fee for Guaranteed AutoClaim should be less than initial one set')
  })

  it('Should set claimer guaranteed fees if they are lower than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    const newGasOffsetCorrection = gasOffsetCorrection.sub(new BN('100'))
    await SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      newGasOffsetCorrection
    )

    expect(await(SNXLinkV2Instance.platformFee())).to.be.eq.BN(platformFee)
    expect(await(SNXLinkV2Instance.claimerFee())).to.be.eq.BN(claimerFee)
    expect(await(SNXLinkV2Instance.platformFeeGuaranteed())).to.be.eq.BN(platformFeeGuaranteed)
    expect(await(SNXLinkV2Instance.claimerFeeGuaranteed())).to.be.eq.BN(claimerFeeGuaranteed)
    expect(await(SNXLinkV2Instance.gasOffsetCorrection())).to.be.eq.BN(newGasOffsetCorrection)
  })

  it('Should fail if claimer guaranteed fees greated than initial setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")
    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await truffleAssert.reverts(SNXLinkV2Instance.changeFees(
      platformFee,
      claimerFee,
      platformFeeGuaranteed,
      claimerFeeGuaranteed,
      gasOffsetCorrection.add(new BN('100'))
    ), 'Gas correction should be less than initial one set')
  })

  it('Should migrate with guaranteed disabled if user is registered', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.002"))
    const value = web3.utils.toWei("0.03")

    const migrationMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const migrationMaxFeePerClaim = new BN(web3.utils.toWei("0.005"))

    await SNXLinkV1Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .migrateUser(
      migrationMaxGasPrice,
      migrationMaxFeePerClaim,
      true,
      {
        from: user,
      }
    )

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN(value)

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(migrationMaxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(migrationMaxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.false
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.true

    expect(await(SNXLinkV2Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV2Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.migratedUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should migrate with funds with guaranteed disabled if user is registered', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    const migrationMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const migrationMaxFeePerClaim = new BN(web3.utils.toWei("0.005"))
    const migrationValue = web3.utils.toWei("0.05")

    await SNXLinkV1Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .migrateUser(
        migrationMaxGasPrice,
        migrationMaxFeePerClaim,
        true,
        {
          from: user,
          value: migrationValue
        }
      )

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN((new BN(value)).add((new BN(migrationValue))))

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(migrationMaxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(migrationMaxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.false
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.true

    expect(await(SNXLinkV2Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV2Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.migratedUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should not migrate if not registered', async() => {
    const user = accounts[2]

    const migrationMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const migrationMaxFeePerClaim = new BN(web3.utils.toWei("0.005"))
    const migrationValue = web3.utils.toWei("0.05")

    await truffleAssert.reverts(SNXLinkV2Instance
      .migrateUser(
        migrationMaxGasPrice,
        migrationMaxFeePerClaim,
        true,
        {
          from: user,
          value: migrationValue
        }
      ), 'User must be registered to previous contract to be migrated')
  })

  it('Should migrate with guaranteed disabled if user is registered', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.002"))
    const value = web3.utils.toWei("0.03")

    const migrationMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const migrationMaxFeePerClaim = new BN(web3.utils.toWei("0.005"))
    const migrationValue = web3.utils.toWei("0.05")

    await SNXLinkV1Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .migrateUser(
        migrationMaxGasPrice,
        migrationMaxFeePerClaim,
        true,
        {
          from: user,
        }
      )

    await truffleAssert.reverts(SNXLinkV2Instance
      .migrateUser(
        migrationMaxGasPrice,
        migrationMaxFeePerClaim,
        true,
        {
          from: user,
          value: migrationValue
        }
      ), 'User is already registered')
  })

  it('Should migrate with guaranteed if user is registered', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.002"))
    const value = web3.utils.toWei("0.03")

    const migrationMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const migrationMaxFeePerClaim = new BN(web3.utils.toWei("0.005"))

    await SNXLinkV1Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .migrateUser(
        migrationMaxGasPrice,
        migrationMaxFeePerClaim,
        false,
        {
          from: user,
        }
      )

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN(value)

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(migrationMaxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(migrationMaxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.false
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.false

    expect(await(SNXLinkV2Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV2Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.migratedUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should migrate with funds with guaranteed if user is registered', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    const migrationMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const migrationMaxFeePerClaim = new BN(web3.utils.toWei("0.005"))
    const migrationValue = web3.utils.toWei("0.05")

    await SNXLinkV1Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .migrateUser(
        migrationMaxGasPrice,
        migrationMaxFeePerClaim,
        false,
        {
          from: user,
          value: migrationValue
        }
      )

    expect(await SNXLinkV2Instance.isRegistered(user)).to.be.true

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN((new BN(value)).add((new BN(migrationValue))))

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(migrationMaxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(migrationMaxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.false
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.false

    expect(await(SNXLinkV2Instance.registeredUsers(0))).to.be.eq.string(user)
    expect(await(SNXLinkV2Instance.registeredUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.migratedUsersCount())).to.be.eq.BN(1)
    expect(await(SNXLinkV2Instance.disabledUsersCount())).to.be.eq.BN(0)
  })

  it('Should apply setting', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    const newMaxGasPrice = new BN(web3.utils.toWei("3", "gwei"))
    const newMaxFeePerClaim = new BN(web3.utils.toWei("0.006"))
    const newGuaranteedAutoClaimEnabled = false
    const newEnabled = false

    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .applySettings(
        newMaxGasPrice,
        newMaxFeePerClaim,
        newGuaranteedAutoClaimEnabled,
        newEnabled,
        {
          from: user,
        }
      )


    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(newMaxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(newMaxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.true
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.true
  })

  it('Should apply setting and funds', async() => {
    const user = accounts[2]
    const maxGasPrice = new BN(web3.utils.toWei("2", "gwei"))
    const maxFeePerClaim = new BN(web3.utils.toWei("0.003"))
    const value = web3.utils.toWei("0.03")

    const newMaxGasPrice = new BN(web3.utils.toWei("4", "gwei"))
    const newMaxFeePerClaim = new BN(web3.utils.toWei("0.008"))
    const newGuaranteedAutoClaimEnabled = false
    const newEnabled = false
    const newValue = web3.utils.toWei("0.05")

    await SNXLinkV2Instance
      .register(
        maxGasPrice,
        maxFeePerClaim,
        false,
        {
          from: user,
          value,
        }
      )

    await SNXLinkV2Instance
      .applySettings(
        newMaxGasPrice,
        newMaxFeePerClaim,
        newGuaranteedAutoClaimEnabled,
        newEnabled,
        {
          from: user,
          value: newValue,
        }
      )

    const wallet = await SNXLinkV2Instance.userFeeWallets(user)
    expect(await web3.eth.getBalance(wallet)).to.eq.BN((new BN(value)).add((new BN(newValue))))

    expect(await(SNXLinkV2Instance.userMaxGasPrices(user))).to.eq.BN(newMaxGasPrice)
    expect(await(SNXLinkV2Instance.userMaxFeePerClaim(user))).to.eq.BN(newMaxFeePerClaim)
    expect(await(SNXLinkV2Instance.userAutoClaimDisabled(user))).to.be.true
    expect(await(SNXLinkV2Instance.userGuaranteedAutoClaimDisabled(user))).to.be.true
  })
});
