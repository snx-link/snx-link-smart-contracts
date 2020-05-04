pragma solidity 0.4.25;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./interfaces/IMultiSigWalletWithDailyLimit.sol";
import "./interfaces/IMultiSigWalletWithDailyLimitFactory.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IDelegateApprovalsV2.sol";
import "./interfaces/ISynthetix.sol";
import "./interfaces/ISynthetixState.sol";

import "./SNXLinkV1.sol";

import "./utils/Withdrawable.sol";


contract SNXLinkV2 is Withdrawable, IFeePool, IDelegateApprovalsV2 {
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
    // @notice Mapping user guaranteed auto-claim status
    mapping(address => bool) public userGuaranteedAutoClaimDisabled;

    // @notice Gnosis Wallet Factory
    IMultiSigWalletWithDailyLimitFactory public userFeeWalletFactory;
    // @notice Synthetix FeePool
    IFeePool public snxFeePool;
    // @notice Synthetix DelegateApprovals
    IDelegateApprovalsV2 public snxDelegateApprovals;
    // @notice Synthetix Main
    ISynthetix public snxSynthetix;
    // @notice Synthetix State
    ISynthetixState public snxSynthetixState;

    // @notice Previous SNXLink version
    SNXLinkV1 public previousVersion;

    // @notice Platform fee wallet
    address public feeCollector;
    // @notice Platform fee
    uint256 public initialPlatformFee;
    uint256 public platformFee;
    // @notice Claimer fee
    uint256 public initialClaimerFee;
    uint256 public claimerFee;
    // @notice Platform fee for Guaranteed Autoclaim
    uint256 public initialPlatformFeeGuaranteed;
    uint256 public platformFeeGuaranteed;
    // @notice Claimer fee for Guaranteed Autoclaim
    uint256 public initialClaimerFeeGuaranteed;
    uint256 public claimerFeeGuaranteed;

    // @notice Gas correction offset
    uint256 public initialGasOffsetCorrection;
    uint256 public gasOffsetCorrection;

    // @notice Registered users
    address[] public registeredUsers;

    // @notice Count of total users registered
    uint256 public registeredUsersCount;

    // @notice Count of total users migrated
    uint256 public migratedUsersCount;

    // @notice Count of total users disabled
    uint256 public disabledUsersCount;

    // @notice Total fees claimed;
    uint256 public totalFeesClaimed;

    // @notice Total rewards claimed;
    uint256 public totalRewardsClaimed;

    /// Events

    // @notice Emits when fee sent to the claimer.
    event PayFeeToClaimer(address indexed claimer, uint256 amount);

    // @notice Emits when fee sent to the platform.
    event PayFeeToPlatform();

    // @notice Emits when claimer claims on behalf of user.
    event Claim(
        address indexed user,
        address indexed claimer,
        uint256 availableFees,
        uint256 availableRewards,
        bool burnedSynths
    );

    // @notice Emits when the user register.
    event Register(address indexed user);

    // @notice Emits when the user migrate.
    event Migrate(address indexed user);

    // @notice Emits when the user change settings.
    event ChangeSettings(
        address indexed user,
        uint256 maxGasPrice,
        uint256 maxFeePerClaim,
        uint256 enabled,
        uint256 enableGuaranteedAutoClaim
    );

    // @notice Emits when the fees are changed.
    event ChangeFees(
        uint256 platformFee,
        uint256 claimerFee,
        uint256 platformFeeGuaranteed,
        uint256 claimerFeeGuaranteed,
        uint256 gasOffsetCorrection
    );

    /// Modifiers

    // @dev Throws if the user does not exists
    modifier onlyRegisteredUser(address user) {
        require(isRegistered(user), "Auch! User is not registered");
        _;
    }

    // @dev Throws if the gasPrice is invalid
    modifier validMaxGasPrice(uint256 maxGasPrice) {
        require(maxGasPrice != 0, "Max Gas Price should be greater than 0");
        _;
    }

    // @dev Throws if the gasPrice is invalid
    modifier validMaxFeePerClaim(uint256 maxFeePerClaim) {
        require(maxFeePerClaim != 0, "Max Fee per Claim should be greater than 0");
        _;
    }

    /// Logic

    constructor(
        address _userFeeWalletFactory,
        address _snxFeePool,
        address _snxDelegateApprovals,
        address _snxSynthetix,
        address _snxSynthetixState,
        address _feeCollector,
        address _previousVersion,
        uint256 _platformFee,
        uint256 _platformFeeGuaranteed,
        uint256 _claimerFee,
        uint256 _claimerFeeGuaranteed,
        uint256 _gasOffsetCorrection
    ) public {
        userFeeWalletFactory = IMultiSigWalletWithDailyLimitFactory(_userFeeWalletFactory);

        snxFeePool = IFeePool(_snxFeePool);
        snxDelegateApprovals = IDelegateApprovalsV2(_snxDelegateApprovals);
        snxSynthetix = ISynthetix(_snxSynthetix);
        snxSynthetixState = ISynthetixState(_snxSynthetixState);

        previousVersion = SNXLinkV1(_previousVersion);

        feeCollector = _feeCollector;
        platformFee = initialPlatformFee = _platformFee;
        platformFeeGuaranteed = initialPlatformFeeGuaranteed = _platformFeeGuaranteed;
        claimerFee = initialClaimerFee = _claimerFee;
        claimerFeeGuaranteed = initialClaimerFeeGuaranteed = _claimerFeeGuaranteed;

        gasOffsetCorrection = initialGasOffsetCorrection = _gasOffsetCorrection;
    }

    function changeFees(
        uint256 _platformFee,
        uint256 _claimerFee,
        uint256 _platformFeeGuaranteed,
        uint256 _claimerFeeGuaranteed,
        uint256 _gasOffsetCorrection
    ) external onlyOwner {
        require(_platformFee <= initialPlatformFee, "Platform fee should be less than initial one set");
        require(_claimerFee <= initialClaimerFee, "Claimer fee should be less than initial one set");
        require(
            _platformFeeGuaranteed <= initialPlatformFeeGuaranteed,
            "Platform fee for Guaranteed AutoClaim should be less than initial one set"
        );
        require(
            _claimerFeeGuaranteed <= initialClaimerFeeGuaranteed,
            "Claimer fee for Guaranteed AutoClaim should be less than initial one set"
        );
        require(_gasOffsetCorrection <= initialGasOffsetCorrection, "Gas correction should be less than initial one set");

        platformFee = _platformFee;
        claimerFee = _claimerFee;
        platformFeeGuaranteed = _platformFeeGuaranteed;
        claimerFeeGuaranteed = _claimerFeeGuaranteed;
        gasOffsetCorrection = _gasOffsetCorrection;

        emit ChangeFees(platformFee, claimerFee, platformFeeGuaranteed, claimerFeeGuaranteed, gasOffsetCorrection);
    }

    function isRegistered(address user) public view returns (bool) {
        return address(userFeeWallets[user]) != address(0);
    }

    function register(
        uint256 _maxGasPrice,
        uint256 _maxFeePerClaim,
        bool _autoClaimGuaranteedDisabled
    ) external payable validMaxGasPrice(_maxGasPrice) validMaxFeePerClaim(_maxFeePerClaim) returns (address) {
        require(!isRegistered(msg.sender), "User already registered");

        address[] memory owners = new address[](2);
        owners[0] = msg.sender;
        owners[1] = address(this);

        address userWallet = userFeeWalletFactory.create(owners, 1, 0);

        userFeeWallets[msg.sender] = IMultiSigWalletWithDailyLimit(userWallet);

        require(userWallet.call.value(msg.value)(""), "Transfer failed");

        userMaxGasPrices[msg.sender] = _maxGasPrice;
        userMaxFeePerClaim[msg.sender] = _maxFeePerClaim;
        userGuaranteedAutoClaimDisabled[msg.sender] = _autoClaimGuaranteedDisabled;

        registeredUsersCount++;
        registeredUsers.push(msg.sender);
        emit Register(msg.sender);

        return userWallet;
    }

    function migrateUser(
        uint256 _maxGasPrice,
        uint256 _maxFeePerClaim,
        bool _autoClaimGuaranteedDisabled
    ) external payable {
        require(previousVersion.isRegistered(msg.sender), "User must be registered to previous contract to be migrated");
        require(!isRegistered(msg.sender), "User is already registered");

        address userWallet = previousVersion.userFeeWallets(msg.sender);
        userFeeWallets[msg.sender] = IMultiSigWalletWithDailyLimit(userWallet);
        userMaxGasPrices[msg.sender] = _maxGasPrice;
        userMaxFeePerClaim[msg.sender] = _maxFeePerClaim;
        userGuaranteedAutoClaimDisabled[msg.sender] = _autoClaimGuaranteedDisabled;

        if (msg.value > 0) {
            require(userWallet.call.value(msg.value)(""), "Transfer failed");
        }

        registeredUsersCount++;
        registeredUsers.push(msg.sender);

        migratedUsersCount++;

        emit Migrate(msg.sender);
    }

    function setMaxGasPrice(uint256 _maxGasPrice) external validMaxGasPrice(_maxGasPrice) onlyRegisteredUser(msg.sender) {
        require(userMaxGasPrices[msg.sender] != _maxGasPrice, "Same setting");

        userMaxGasPrices[msg.sender] = _maxGasPrice;
        emit ChangeSettings(msg.sender, _maxGasPrice, 0, 0, 0);
    }

    function setMaxFeePerClaim(uint256 _maxFeePerClaim)
        external
        validMaxFeePerClaim(_maxFeePerClaim)
        onlyRegisteredUser(msg.sender)
    {
        require(userMaxFeePerClaim[msg.sender] != _maxFeePerClaim, "Same setting");

        userMaxFeePerClaim[msg.sender] = _maxFeePerClaim;
        emit ChangeSettings(msg.sender, 0, _maxFeePerClaim, 0, 0);
    }

    function enable() external onlyRegisteredUser(msg.sender) {
        require(userAutoClaimDisabled[msg.sender], "Already enabled");

        userAutoClaimDisabled[msg.sender] = false;
        disabledUsersCount--;
        emit ChangeSettings(msg.sender, 0, 0, 1, 0);
    }

    function disable() external onlyRegisteredUser(msg.sender) {
        require(!userAutoClaimDisabled[msg.sender], "Already disabled");

        userAutoClaimDisabled[msg.sender] = true;
        disabledUsersCount++;
        emit ChangeSettings(msg.sender, 0, 0, 2, 0);
    }

    function enableGuaranteedAutoClaim() external onlyRegisteredUser(msg.sender) {
        require(userGuaranteedAutoClaimDisabled[msg.sender], "Already enabled");

        userGuaranteedAutoClaimDisabled[msg.sender] = false;
        emit ChangeSettings(msg.sender, 0, 0, 0, 1);
    }

    function disableGuaranteedAutoClaim() external onlyRegisteredUser(msg.sender) {
        require(!userGuaranteedAutoClaimDisabled[msg.sender], "Already disabled");

        userGuaranteedAutoClaimDisabled[msg.sender] = true;
        emit ChangeSettings(msg.sender, 0, 0, 0, 2);
    }

    function applySettings(
        uint256 _maxGasPrice,
        uint256 _maxFeePerClaim,
        bool _enabled,
        bool _userGuaranteedAutoClaimEnabled
    ) external payable validMaxGasPrice(_maxGasPrice) validMaxFeePerClaim(_maxFeePerClaim) onlyRegisteredUser(msg.sender) {
        uint256 maxGasPrice = 0;
        uint256 maxFeePerClaim = 0;
        uint256 enabled = 0;
        uint256 userGuaranteedAutoClaimEnabled = 0;

        bool changed = false;

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

        if (userGuaranteedAutoClaimDisabled[msg.sender] == _userGuaranteedAutoClaimEnabled) {
            if (_userGuaranteedAutoClaimEnabled) {
                userGuaranteedAutoClaimDisabled[msg.sender] = false;
                userGuaranteedAutoClaimEnabled = 1;
            } else {
                userGuaranteedAutoClaimDisabled[msg.sender] = true;
                userGuaranteedAutoClaimEnabled = 2;
            }

            changed = true;
        }

        require(changed, "Nothing changed");

        emit ChangeSettings(msg.sender, maxGasPrice, maxFeePerClaim, enabled, userGuaranteedAutoClaimEnabled);

        if (msg.value > 0) {
            require(address(userFeeWallets[msg.sender]).call.value(msg.value)(""), "Transfer failed");
        }
    }

    function topUp() external payable onlyRegisteredUser(msg.sender) {
        require(address(userFeeWallets[msg.sender]).call.value(msg.value)(""), "Transfer failed");
    }

    function withdraw(uint256 value) external onlyRegisteredUser(msg.sender) nonReentrant {
        IMultiSigWalletWithDailyLimit userFeeWallet = userFeeWallets[msg.sender];

        uint256 txid = userFeeWallet.submitTransaction(msg.sender, value, "");

        (, , , bool executed) = userFeeWallet.transactions(txid);
        require(executed, "Unable to withdraw from user wallet!");
    }

    function canClaimFor(
        address authoriser,
        address /* delegate */
    ) external view returns (bool) {
        return snxDelegateApprovals.canClaimFor(authoriser, address(this));
    }

    function canBurnFor(
        address authoriser,
        address /* delegate */
    ) external view returns (bool) {
        return snxDelegateApprovals.canBurnFor(authoriser, address(this));
    }

    function isFeesClaimable(address account) public view returns (bool) {
        return snxFeePool.isFeesClaimable(account);
    }

    function feesAvailable(address account) public view returns (uint, uint) {
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

    function claimOnBehalf(address user) public nonReentrant returns (bool) {
        // Start gas counting
        uint256 startGas = gasleft();

        require(isRegistered(user), "User is not registered");

        require(!userAutoClaimDisabled[user], "User disabled auto-claim");

        require(tx.gasprice <= userMaxGasPrices[user], "Gas Price higher than user configured");

        (uint256 availableFees, uint256 availableRewards) = snxFeePool.feesAvailable(user);

        bool burnedSynths = false;
        if (
            !userGuaranteedAutoClaimDisabled[user] &&
            snxSynthetix.collateralisationRatio(user) > snxSynthetixState.issuanceRatio()
        ) {
            snxSynthetix.burnSynthsToTargetOnBehalf(user);
            burnedSynths = true;
        }

        require(snxFeePool.claimOnBehalf(user), "Failed to ClaimOnBehalf");

        totalFeesClaimed = totalFeesClaimed.add(availableFees);
        totalRewardsClaimed = totalRewardsClaimed.add(availableRewards);
        emit Claim(user, msg.sender, availableFees, availableRewards, burnedSynths);

        uint256 gasUsed = startGas - gasleft();

        // End gas counting

        uint256 totalRefundForClaimer = ((gasUsed.add(gasOffsetCorrection)).mul(tx.gasprice)).add(
            burnedSynths ? claimerFeeGuaranteed : claimerFee
        );

        uint256 totalToWithdraw = totalRefundForClaimer.add(burnedSynths ? platformFeeGuaranteed : platformFee);
        require(totalToWithdraw <= userMaxFeePerClaim[user], "Total cost higher than user configured");

        IMultiSigWalletWithDailyLimit userFeeWallet = userFeeWallets[user];
        uint256 txid = userFeeWallet.submitTransaction(address(this), totalToWithdraw, "");

        (, , , bool executed) = userFeeWallet.transactions(txid);
        require(executed, "Unable to withdraw from user wallet!");

        require(msg.sender.call.value(totalRefundForClaimer)(""), "Transfer to claimer failed");
        emit PayFeeToClaimer(msg.sender, totalRefundForClaimer);

        require(
            feeCollector.call.value(burnedSynths ? platformFeeGuaranteed : platformFee)(""),
            "Transfer to feeCollector failed"
        );
        emit PayFeeToPlatform();

        return true;
    }

    function() public payable {}
}
