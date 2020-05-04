pragma solidity 0.4.25;


interface IMultiSigWalletWithDailyLimit {
    function transactions(uint256 id)
        external
        view
        returns (
            address,
            uint,
            bytes,
            bool
        );

    /// @dev Allows an owner to submit and confirm a transaction.
    /// @param destination Transaction target address.
    /// @param value Transaction ether value.
    /// @param data Transaction data payload.
    /// @return Returns transaction ID.
    function submitTransaction(
        address destination,
        uint value,
        bytes data
    ) external returns (uint transactionId);

    /// @dev Allows to change the daily limit. Transaction has to be sent by wallet.
    /// @param _dailyLimit Amount in wei.
    function changeDailyLimit(uint _dailyLimit) external;
}
