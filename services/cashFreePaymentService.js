const axios = require('axios');
const CashFreeTransaction = require('../models/CashFreeTransaction');

const API_VERSION = '2024-01-01'
const CLIENT_ID = config.X_CLIENT_ID;
const CLIENT_SECRET = config.X_CLIENT_SECRET;
const BASE_URL = config.BASE_URL;
const GET_TRANSFER = config.GET_TRANSFERS;

const getToken = async () => {
    try {
        const response = await axios.post(`${BASE_URL}/v1/authorize`, {}, {
            headers: {
                'X-Client-Id': CLIENT_ID,
                'X-Client-Secret': CLIENT_SECRET,
            },
        });

        if (response.data.status === 'SUCCESS') {
            return response.data.data.token;
        } else {
            throw new Error(response.data.message);
            //return response.data.message;
        }
    } catch (error) {
        console.error('Error fetching token:', error.message);
        //throw new Error('Failed to fetch authorization token.');
        return error.message;
    }
};

const getBalance = async (token) => {
    try {
        const response = await axios.get(`${BASE_URL}/v1/getBalance`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.data.status === 'SUCCESS') {
            return parseFloat(response.data.data.availableBalance);
        } else {
            throw new Error(response.data.message);
        }
    } catch (error) {
        console.error('Error fetching balance:', error.message);
        //throw new Error('Failed to fetch account balance.');
        return error.message;
    }
};

const updateToDB = (transferStatus) => {
    return CashFreeTransaction.findOneAndUpdate(
        {transfer_id: transferStatus.data.transfer_id},
        [
            {
                $set: {
                    transfer_id: transferStatus.data.transfer_id || null,
                    cf_transfer_id: transferStatus.data.cf_transfer_id || null,
                    status: transferStatus.data.status || null,
                    status_code: transferStatus.data.status_code || null,
                    status_description: transferStatus.data.status_description || null,
                    beneficiary_details: {
                        beneficiary_id: transferStatus.data.beneficiary_details.beneficiary_id || null
                    },
                    currency: transferStatus.data.currency || null,
                    transfer_amount: transferStatus.data.transfer_amount || null,
                    transfer_service_charge: transferStatus.data.transfer_service_charge || null,
                    transfer_service_tax: transferStatus.data.transfer_service_tax || null,
                    transfer_mode: transferStatus.data.transfer_mode || null,
                    transfer_utr: transferStatus.data.transfer_utr || null,
                    fundsource_id: transferStatus.data.fundsource_id || null,
                    added_on: transferStatus.data.added_on || null,
                    updated_on: transferStatus.data.updated_on || null
                }
            }
        ], { returnDocument: "after"});
};

const makePayment = async (mobile, name, cash, token) => {
    try {
        if (!token) {
            token = await this.getToken();
        }

        const transferId = (mobile +"_"+ Date.now()).toString();

        const paymentResponse = await axios.post(
            `${BASE_URL}/v1.2/directTransfer`,
            {
                amount: parseFloat(cash.toString()).toString(),
                transferId: transferId,
                transferMode: 'phone',
                remarks: 'Aultra paints reward',
                beneDetails: {
                    name: name.toString(),
                    email: 'info@aultrapaints.com',
                    phone: mobile.toString(),
                    address1: 'Hyderabad'
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        const responseData = paymentResponse.data;
        let cashFreeTransaction = null;
        if (responseData.data != null ){
            cashFreeTransaction = CashFreeTransaction.create({
                transfer_id: transferId,
                cf_transfer_id: responseData.data.referenceId,
                status: responseData.status,
                status_description: responseData.message
            });
        }else {
            cashFreeTransaction = CashFreeTransaction.create({
                transfer_id: transferId,
                status: responseData.status,
                status_description: responseData.message
            });
        }

        if (responseData.subCode === '400') {
            return { status: responseData.subCode, message: responseData.message };
            //throw new Error({status: responseData.subCode, message: responseData.message});
        }
        //const { referenceId, utr, acknowledged } = responseData.data;
        if (responseData.subCode === '200' || responseData.subCode === '201' || responseData.subCode === '202') {
            return { status: responseData.subCode, message: responseData.message, data: responseData.data };
            /*for (let attempt = 0; attempt < 3; attempt++) {
                const transferStatus = await checkTransferStatus(transferId);
                console.log('transfer status - ', transferStatus);
                if (transferStatus.data.status === 'SUCCESS' && transferStatus.data.status_code === 'COMPLETED') {
                    cashFreeTransaction = await updateToDB(transferStatus);
                    return {status: 200, message: 'Transfer successful.'}
                }else if (transferStatus.data.status === 'REJECTED'){
                    cashFreeTransaction = await updateToDB(transferStatus);
                    throw {status: 400, message: 'Transfer rejected.', data: {status_code: transferStatus.data.status_code, status_description: transferStatus.data.status_description}};
                }else {
                    await updateToDB(transferStatus);
                }

                if (attempt < 2) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Retry delay
                }
            }
            throw new Error({status: 400, message: 'Transfer status check failed after retries.'})*/
            //console.log('Transfer status check failed after retries.');
        }
    } catch (error) {
        console.error('Error during makePayment:', error);
        //throw new Error('Payment processing error: ' + error.message);
        return error;
    }
};

const checkTransferStatus = async (referenceId) => {
    try {
        return await axios.get(`${GET_TRANSFER}?transfer_id=${referenceId}`, {
            headers: {
                'x-api-version': API_VERSION,
                'x-client-id': CLIENT_ID,
                'x-client-secret': CLIENT_SECRET
            }
        });

    } catch (error) {
        console.error('Error checking transfer status:', error.message);
        return error.message;
    }
};

const pay2Phone = async (mobile, name, cash) => {
    try {
        // Get auth token
        const token = await getToken();
        // Get account balance
        const balance = await getBalance(token);
        if (balance > cash) {
            // Make payment
            const paymentResult = await makePayment(mobile, name, cash, token);
            console.log(paymentResult);
            if (paymentResult.status === '400') {
                return { success: false, message: paymentResult.message, data: paymentResult.data };
            }else if (paymentResult.status === '200' || paymentResult.status === '201' || paymentResult.status === '202') {
                return { success: true, message: paymentResult.message };
            }else {
                return { success: false, message: paymentResult.message };
            }
        }
    } catch (error) {
        console.error('Payment error:', error);
        return { success: false, message: error.message };
    }
};

module.exports = { pay2Phone, checkTransferStatus, updateToDB };
