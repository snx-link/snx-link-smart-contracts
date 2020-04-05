pragma solidity 0.4.25;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import './interfaces/IMultiSigWalletWithDailyLimit.sol';
import "./interfaces/IMultiSigWalletWithDailyLimitFactory.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IDelegateApprovals.sol";

import "./utils/Withdrawable.sol";

contract SNXLinkV1 is Withdrawable, IFeePool, IDelegateApprovals {
    using SafeMath for uint256;

    /// Storage

    // @notice Mapping user max gas price settings
    mapping(address => uint256) public userMaxGasPrices;
    // @notice Mapping user max fee per claim
    mapping(address => uint256) public userMaxFeePerClaim;
    // @notice Mapping user fee wallets
    mapping(address => IMultiSigWalletWithDailyLimit) public userFeeWallets;
    // @notice Mapping user auto-claim activation status
    mapping(address => bool) public userAutoClaimDisabled;

    // @notice Gnosis Wallet Factory
    IMultiSigWalletWithDailyLimitFactory public userFeeWalletFactory;
    // @notice Synthetix FeePool
    IFeePool public snxFeePool;
    // @notice Synthetix DelegateApprovals
    IDelegateApprovals public snxDelegateApprovals;

    // @notice Platform fee wallet
    address public feeCollector;
    // @notice Platform fee
    uint256 public platformFee;
    // @notice Claimer fee
    uint256 public claimerFee;

    // @notice Gas correction offset
    uint256 public gasOffsetCorrection;

    // @notice Registered users
    address[] public registeredUsers;

    // @notice Count of total users registered
    uint256 public registeredUsersCount;

    // @notice Count of total users disabled
    uint256 public disabledUsersCount;

    // @notice Total fees claimed;
    uint256 public totalFeesClaimed;

    // @notice Total rewards claimed;
    uint256 public totalRewardsClaimed;


    /// Events

    // @notice Emits when fee sent to the claimer.
    event PayFeeToClaimer(
        address indexed claimer,
        uint256 amount
    );

    // @notice Emits when fee sent to the platform.
    event PayFeeToPlatform();

    // @notice Emits when claimer claims on behalf of user.
    event Claim(
        address indexed user,
        address indexed claimer,
        uint256 availableFees,
        uint256 availableRewards
    );

    // @notice Emits when the user register.
    event Register(address indexed user);

    // @notice Emits when the user change settings.
    event ChangeSettings(
        address indexed user,
        uint256 maxGasPrice,
        uint256 maxFeePerClaim,
        uint256 enabled
    );


    /// Modifiers

    // @dev Throws if the user does not exists
    modifier onlyRegisteredUser(address user) {
        require(isRegistered(user), 'Auch! User is not registered');
        _;
    }

    // @dev Throws if the gasPrice is invalid
    modifier validMaxGasPrice(uint256 maxGasPrice) {
        require(maxGasPrice != 0, 'Max Gas Price should be greater than 0');
        _;
    }

    // @dev Throws if the gasPrice is invalid
    modifier validMaxFeePerClaim(uint256 maxFeePerClaim) {
        require(maxFeePerClaim != 0, 'Max Fee per Claim should be greater than 0');
        _;
    }

    /// Logic

    constructor(
        address _userFeeWalletFactory,
        address _snxFeePool,
        address _snxDelegateApprovals,
        address _feeCollector,
        uint256 _platformFee,
        uint256 _claimerFee,
        uint256 _gasOffsetCorrection
    ) public {
        userFeeWalletFactory = IMultiSigWalletWithDailyLimitFactory(_userFeeWalletFactory);

        snxFeePool = IFeePool(_snxFeePool);
        snxDelegateApprovals = IDelegateApprovals(_snxDelegateApprovals);

        feeCollector = _feeCollector;
        platformFee = _platformFee;
        claimerFee = _claimerFee;

        gasOffsetCorrection = _gasOffsetCorrection;
    }

    function isRegistered(address user) public view returns (bool) {
        return address(userFeeWallets[user]) != address(0);
    }

    function register(uint256 _maxGasPrice, uint256 _maxFeePerClaim)
        validMaxGasPrice(_maxGasPrice)
        validMaxFeePerClaim(_maxFeePerClaim)
        external payable returns (address) {
        require(!isRegistered(msg.sender), 'User already registered');

        address[] memory owners = new address[](2);
        owners[0] = msg.sender;
        owners[1] = address(this);

        address userWallet = userFeeWalletFactory.create(
            owners,
            1,
            0
        );

        userFeeWallets[msg.sender] = IMultiSigWalletWithDailyLimit(userWallet);

        require(userWallet.call.value(msg.value)(''), 'Transfer failed');

        userMaxGasPrices[msg.sender] = _maxGasPrice;
        userMaxFeePerClaim[msg.sender] = _maxFeePerClaim;

        registeredUsersCount++;
        registeredUsers.push(msg.sender);
        emit Register(msg.sender);

        return userWallet;
    }

    function setMaxGasPrice(uint256 _maxGasPrice)
        validMaxGasPrice(_maxGasPrice)
        onlyRegisteredUser(msg.sender)
        external {
        require(userMaxGasPrices[msg.sender] != _maxGasPrice, 'Same setting');

        userMaxGasPrices[msg.sender] = _maxGasPrice;
        emit ChangeSettings(msg.sender, _maxGasPrice, 0, 0);
    }

    function setMaxFeePerClaim(uint256 _maxFeePerClaim)
        validMaxFeePerClaim(_maxFeePerClaim)
        onlyRegisteredUser(msg.sender)
        external {
        require(userMaxFeePerClaim[msg.sender] != _maxFeePerClaim, 'Same setting');

        userMaxFeePerClaim[msg.sender] = _maxFeePerClaim;
        emit ChangeSettings(msg.sender, 0, _maxFeePerClaim, 0);
    }

    function enable()
        onlyRegisteredUser(msg.sender)
        external {
        require(userAutoClaimDisabled[msg.sender], 'Already enabled');

        userAutoClaimDisabled[msg.sender] = false;
        disabledUsersCount--;
        emit ChangeSettings(msg.sender, 0, 0, 1);
    }

    function disable()
        onlyRegisteredUser(msg.sender)
        external {
        require(!userAutoClaimDisabled[msg.sender], 'Already disabled');

        userAutoClaimDisabled[msg.sender] = true;
        disabledUsersCount++;
        emit ChangeSettings(msg.sender, 0, 0, 2);
    }

    function applySettings(
        uint256 _maxGasPrice,
        uint256 _maxFeePerClaim,
        bool _enabled
    )   validMaxGasPrice(_maxGasPrice)
        validMaxFeePerClaim(_maxFeePerClaim)
        onlyRegisteredUser(msg.sender)
        external {

        uint256 maxGasPrice;
        uint256 maxFeePerClaim;
        uint256 enabled;

        bool changed;

        if (userMaxGasPrices[msg.sender] != _maxGasPrice) {
            userMaxGasPrices[msg.sender] = _maxGasPrice;
            maxGasPrice = _maxGasPrice;
            changed = true;
        }

        if (userMaxFeePerClaim[msg.sender] != _maxFeePerClaim) {
            userMaxFeePerClaim[msg.sender] = _maxFeePerClaim;
            maxFeePerClaim = _maxFeePerClaim;
            changed = true;
        }

        if (userAutoClaimDisabled[msg.sender] == _enabled) {
            if (_enabled) {
                userAutoClaimDisabled[msg.sender] = false;
                disabledUsersCount--;
                enabled = 1;
            } else {
                userAutoClaimDisabled[msg.sender] = true;
                disabledUsersCount++;
                enabled = 2;
            }

            changed = true;
        }

        require(changed, 'Nothing changed');

        emit ChangeSettings(
            msg.sender,
            maxGasPrice,
            maxFeePerClaim,
            enabled
        );
    }

    function topUp()
        onlyRegisteredUser(msg.sender)
        external payable {
        require(address(userFeeWallets[msg.sender]).call.value(msg.value)(''), 'Transfer failed');
    }

    function withdraw(uint256 value)
        onlyRegisteredUser(msg.sender)
        nonReentrant
        external {
        IMultiSigWalletWithDailyLimit userFeeWallet = userFeeWallets[msg.sender];

        uint256 txid = userFeeWallet.submitTransaction(msg.sender, value, '');

        (,,,bool executed) = userFeeWallet.transactions(txid);
        require(executed, 'Unable to withdraw from user wallet!');
    }

    function canClaimFor(address authoriser, address /* delegate */)
        external view returns (bool) {
        return snxDelegateApprovals.canClaimFor(authoriser, address (this));
    }

    function isFeesClaimable(address account)
        public view returns (bool) {
        return snxFeePool.isFeesClaimable(account);
    }

    function feesAvailable(address account)
        public view returns (uint, uint) {
        return snxFeePool.feesAvailable(account);
    }

    function canClaim(address user) public view returns (bool) {
        (uint256 availableFees, uint256 availableRewards) = snxFeePool.feesAvailable(user);

        return
            isRegistered(user) &&
            !userAutoClaimDisabled[user] &&
            (availableFees > 0 && availableRewards > 0) &&
            snxFeePool.isFeesClaimable(user) &&
            snxDelegateApprovals.canClaimFor(user, address(this));
    }

    function claimOnBehalf(address user)
        nonReentrant
        public returns(bool) {

        // Start gas counting
        uint256 startGas = gasleft();

        require(isRegistered(user), 'User is not registered');

        require(!userAutoClaimDisabled[user], 'User disabled auto-claim');

        require(tx.gasprice <= userMaxGasPrices[user], 'Gas Price higher than user configured');

        (uint256 availableFees, uint256 availableRewards) = snxFeePool.feesAvailable(user);

        require(snxFeePool.claimOnBehalf(user), 'Failed to ClaimOnBehalf');

        totalFeesClaimed = totalFeesClaimed.add(availableFees);
        totalRewardsClaimed = totalRewardsClaimed.add(availableRewards);
        emit Claim(user, msg.sender, availableFees, availableRewards);

        uint256 gasUsed = startGas - gasleft();

        // End gas counting

        uint256 totalRefundForClaimer =
            ((gasUsed.add(gasOffsetCorrection)).mul(tx.gasprice)).add(claimerFee);

        uint256 totalToWithdraw = totalRefundForClaimer.add(platformFee);
        require(totalToWithdraw <= userMaxFeePerClaim[user], 'Total cost higher than user configured');

        IMultiSigWalletWithDailyLimit userFeeWallet = userFeeWallets[user];
        uint256 txid = userFeeWallet.submitTransaction(address(this), totalToWithdraw, '');

        (,,,bool executed) = userFeeWallet.transactions(txid);
        require(executed, 'Unable to withdraw from user wallet!');

        require(msg.sender.call.value(totalRefundForClaimer)(''), 'Transfer to claimer failed');
        emit PayFeeToClaimer(msg.sender, totalRefundForClaimer);

        require(feeCollector.call.value(platformFee)(''), 'Transfer to feeCollector failed');
        emit PayFeeToPlatform();

        return true;
    }

    function () payable {}
}
