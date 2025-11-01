const axios = require('axios');
const CashFreeTransaction = require('../models/CashFreeTransaction');
const CommonFunctions = require('../utils/CommonFuctions');
const logger = require('../utils/logger');
const config = process.env;

const API_VERSION = '2024-01-01'
let CLIENT_ID = null;
let CLIENT_SECRET = null;
let BASE_URL = null;
let UPI_BASE_URL = null;
let GET_TRANSFER = null;
let FUND_SOURCE_ID = null;
const REMARKS = 'Aultra paints reward';
const TRANSFER_MODE = 'upi';
const TRANSFER_CURRENCY = 'INR';
if (config.ACTIVATE_CASHFREE === 'true') {
    CLIENT_ID = config.X_CLIENT_ID;
    CLIENT_SECRET = config.X_CLIENT_SECRET;
    BASE_URL = config.BASE_URL;
    UPI_BASE_URL = config.UPI_BASE_URL;
    GET_TRANSFER = config.GET_TRANSFERS;
    FUND_SOURCE_ID = config.FUND_SOURCE_ID;
}else {
    CLIENT_ID = config.X_CLIENT_ID_QA;
    CLIENT_SECRET = config.X_CLIENT_SECRET_QA;
    BASE_URL = config.BASE_URL_QA;
    UPI_BASE_URL = config.UPI_BASE_URL_QA;
    GET_TRANSFER = config.GET_TRANSFERS_QA;
    FUND_SOURCE_ID = config.FUND_SOURCE_ID_QA;
}

const getToken = async () => {
    try {
        logger.info('Getting token');
        const response = await axios.post(`${BASE_URL}/v1/authorize`, {}, {
            headers: {
                'X-Client-Id': CLIENT_ID,
                'X-Client-Secret': CLIENT_SECRET,
            },
        });

        if (response.data.status === 'SUCCESS') {
            logger.info('Successfully received token.');
            return response.data.data.token;
        } else {
            logger.error('Error while receiving token.');
            throw new Error(response.data.message);
            //return response.data.message;
        }
    } catch (error) {
        logger.error('Error fetching token.', {
            error: error
        });
        return error.message;
    }
};

const verifyUPI = async (token, upi) => {
    try {
        logger.info('Validating upi id.');
        logger.debug('Validating upi id.', {
            upi_id: upi
        });
        const response = await axios.get(`${BASE_URL}/v1/validation/upiDetails?vpa=${upi}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.data.subCode === "200") {
            logger.info('UPI validation successful.');
        } else if (response.data.subCode === "422") {
            logger.error('UPI validation failed.', {
                api_response: response.toString()
            });
        }

        return response;

    } catch (error) {
        logger.error('Error validating upi id.', {
            error: error
        });
        return error.message;
    }
}

const getBalance = async (token) => {
    try {
        logger.info('Getting balance');
        const response = await axios.get(`${BASE_URL}/v1/getBalance`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.data.status === 'SUCCESS') {
            const availableBalance = parseFloat(response.data.data.availableBalance);
            logger.info('Successfully received balance.');
            logger.debug('Successfully received balance.', {
                availableBalance: availableBalance
            });
            return availableBalance;
        } else {
            logger.error('Error while receiving balance.');
            logger.debug('Error while receiving balance.', {
                token: token
            })
            throw new Error(response.data.message);
        }
    } catch (error) {
        logger.error('Error fetching balance:', {
            error: error
        });
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

const createBeneficiary = async (upi, mobile) => {
    let beneficiaryId = await CommonFunctions.sanitize(upi);
    try {
        logger.info('Creating beneficiary details.');
        logger.debug('Creating beneficiary details.', {
            body: { upi, mobile }
        });
        const beneficiaryResponse = await axios.post(
            `${UPI_BASE_URL}/beneficiary`,
            {
                beneficiary_id: beneficiaryId,
                beneficiary_name: mobile.toString(),
                beneficiary_instrument_details: {
                    vpa: upi
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-version': API_VERSION,
                    'x-client-id': CLIENT_ID,
                    'x-client-secret': CLIENT_SECRET
                },
                validateStatus: (status) => true  // Accept all status codes
            }
        );

        if (beneficiaryResponse.status === 201) {
            logger.info('Successfully created beneficiary.');
            logger.debug('Successfully created beneficiary.', {
                beneficiaryId: beneficiaryId
            });
            return beneficiaryId;
        } else if (beneficiaryResponse.status === 409) {
            logger.warn('Beneficiary already exists.');
            logger.debug('Beneficiary already exists.', {
                beneficiaryId: beneficiaryId
            });
            return beneficiaryId;
        } else {
            logger.error(`Error while creating beneficiary.`);
            logger.debug(`Error while creating beneficiary.`, {
                beneficiaryId: beneficiaryId,
                beneficiaryResponse: beneficiaryResponse.data ? beneficiaryResponse.data : beneficiaryResponse.toString()
            });
            //console.error(`Error while creating beneficiary (${beneficiaryId}) ----- `, JSON.stringify(beneficiaryResponse.data));
            return null;
        }
    } catch (error) {
        logger.error(`Error during createBeneficiary.`, {
            error: error
        });
        return error;
    }
}

const makeUPIPayment = async (upi, mobile, cash) => {
    try {
        let beneficiaryId = await createBeneficiary(upi, mobile);

        if (beneficiaryId === null || beneficiaryId === undefined) {
            logger.error('Error while creating beneficiary.');
            return { status: 400, message: 'Error while creating beneficiary.' }
        } else {
            let transferId = await CommonFunctions.sanitize(upi);
            transferId = (transferId +"_"+ Date.now()).toString();
            logger.info('Transfer id created.');
            logger.debug('Transfer id created.', {
                transferId: transferId
            });

            const upiPaymentResponse = await axios.post(
                `${UPI_BASE_URL}/transfers`,
                {
                    transfer_id: transferId,
                    transfer_amount: Number(cash),
                    beneficiary_details: {
                        beneficiary_id: beneficiaryId
                    },
                    transfer_currency: TRANSFER_CURRENCY,
                    transfer_mode: TRANSFER_MODE,
                    transfer_remarks: REMARKS,
                    fundsource_id: FUND_SOURCE_ID,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-version': API_VERSION,
                        'x-client-id': CLIENT_ID,
                        'x-client-secret': CLIENT_SECRET
                    },
                    validateStatus: (status) => true  // Accept all status codes
                }
            );

            if (upiPaymentResponse.status === 200) {
                if (upiPaymentResponse.data.status === 'FAILED' && ( upiPaymentResponse.data.status_code === 'INVALID_BENE_VPA' || upiPaymentResponse.data.status_code === 'INVALID_ACCOUNT_FAIL')) {
                    logger.error(`Error while making payment to ${upi}, ${mobile}, amount: ${cash}`, {
                        error: upiPaymentResponse.data ? upiPaymentResponse.data : upiPaymentResponse.toString()
                    });
                    return { status: 400, message: 'Invalid UPI ID. Please enter correct UPI ID.' }
                }
            }

            if (upiPaymentResponse.status !== 200) {
                logger.error(`Error while making payment to ${upi}, ${mobile}, amount: ${cash}`, {
                    error: upiPaymentResponse.data ? upiPaymentResponse.data : upiPaymentResponse.toString()
                });
                return { status: 400, message: 'Error while making payment.' }
            } else {
                const responseData = upiPaymentResponse.data;
                let cashFreeTransaction = null;
                if (responseData != null ) {
                    cashFreeTransaction = await CashFreeTransaction.create({
                        transfer_id: transferId,
                        cf_transfer_id: responseData.cf_transfer_id,
                        status: responseData.status,
                        status_code: responseData.status_code,
                        status_description: responseData.message,
                        beneficiary_details: responseData.beneficiary_details,
                        currency: responseData.currency ? responseData.currency : TRANSFER_CURRENCY,
                        transfer_amount: responseData.transfer_amount,
                        transfer_mode: responseData.transfer_mode,
                        added_on: responseData.added_on ? responseData.added_on.toString() : new Date().toString(),
                        updated_on: responseData.updated_on ? responseData.updated_on.toString() : new Date().toString()
                    });
                } else {
                    cashFreeTransaction = await CashFreeTransaction.create({
                        transfer_id: transferId,
                        status: responseData.status,
                        status_description: responseData.message,
                        beneficiary_details: {
                            beneficiary_id: beneficiaryId,
                            beneficiary_instrument_details: {
                                vpa: upi
                            }
                        },
                        currency: TRANSFER_CURRENCY,
                        transfer_amount: cash,
                        transfer_mode: TRANSFER_MODE,
                        added_on: new Date().toString(),
                        updated_on: new Date().toString()
                    });
                }
                logger.info(`Payment initiated successfully. CashFree TransactionId - ${cashFreeTransaction._id}`);
                return { status: 200, message: 'Payment initiated successfully.' };
            }
        }
    } catch (error) {
        logger.error('Error during makePayment.', {
            error: error
        });
        return error;
    }
};

const upiPayment = async (upi, mobile, cash) => {
    try {
        // Get auth token
        const token = await getToken();
        /*const verifyUPIResponse = await verifyUPI(token, upi);
        if (verifyUPIResponse.data.subCode === "422") {
            logger.error(`Error while making payment to ${upi}, ${name}, amount: ${cash}`, {
                api_response: verifyUPIResponse.toString()
            });
            console.error(`Error while making payment to ${upi}, ${name}, amount: ${cash} ----- `, verifyUPIResponse);
            return { success: false, message: 'Invalid UPI ID. Please enter correct UPI ID.' }
        } else if (verifyUPIResponse.data.subCode === "200" && verifyUPIResponse.data.accountExists === 'YES') {
            console.log('UPI validation successful. Account exists.');
        }*/
        // Get account balance
        const balance = await getBalance(token);
        if (balance > cash) {
            // Make upi payment
            const upiPaymentResult = await makeUPIPayment(upi, mobile, cash);
            if (upiPaymentResult.status === 400) {
                logger.error('Error while making upi payment.', {
                    error: upiPaymentResult
                });
                return { success: false, message: upiPaymentResult.message };
            }else if (upiPaymentResult.status === 200) {
                logger.info('UPI payment successful.');
                return { success: true, message: upiPaymentResult.message };
            }else {
                logger.error('Error while making upi payment.', {
                    error: upiPaymentResult
                });
                return { success: false, message: upiPaymentResult.message };
            }
        } else {
            return { success: false, message: 'Insufficient balance. Contact Admin.' };
        }
    } catch (error) {
        console.error('Payment error --- ', error);
        logger.error('Error while making upi payment.', {
            error: error
        });
        return { success: false, message: error.message };
    }
}

module.exports = { pay2Phone, checkTransferStatus, updateToDB, upiPayment };
