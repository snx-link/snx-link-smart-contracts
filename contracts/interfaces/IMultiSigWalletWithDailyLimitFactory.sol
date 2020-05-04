pragma solidity 0.4.25;


interface IMultiSigWalletWithDailyLimitFactory {
    /// @dev Allows verified creation of multisignature wallet.
    /// @param _owners List of initial owners.
    /// @param _required Number of required confirmations.
    /// @param _dailyLimit Amount in wei, which can be withdrawn without confirmations on a daily basis.
    /// @return Returns wallet address.
    function create(
        address[] _owners,
        uint _required,
        uint _dailyLimit
    ) external returns (address wallet);
}
