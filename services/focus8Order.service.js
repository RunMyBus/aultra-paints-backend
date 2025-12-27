const axios = require("axios");
const logger = require("../utils/logger");
require("dotenv").config();

const FOCUS8_BASE_URL = process.env.FOCUS8_BASE_URL;



/**
 * ===============================
 * ERP CONFIG (ERP-APPROVED)
 * ===============================
 */
const FOCUS8_CONFIG = {
    BRANCH_CODE: "KUKATPALLY"
};

/**
 * ===============================
 * LOGIN TO FOCUS8
 * ===============================
 */
async function loginToFocus8() {
    const res = await axios.post(`${FOCUS8_BASE_URL}/login`, {
        url: null,
        data: [{
            UserName: "MobileApp",
            Password: "Aultra$so",
            CompanyCode: "9Y0"
        }]
    });

    if (!res.data?.data?.length) {
        throw new Error("Focus8 login failed");
    }

    return res.data.data[0].fSessionId;
}

/**
 * ===============================
 * GET CUSTOMER ACCOUNT ID
 * ===============================
 */
async function getCustomerAccountId(mobile, fSessionId) {
    const res = await axios.get(
        `${FOCUS8_BASE_URL}/List/Masters/Core__Account?sTelNo=${mobile}`,
        { headers: { fSessionId } }
    );

    const customer = (res.data?.data || []).find(
        acc => acc.iAccountType === "Customer" && acc.sTelNo === mobile
    );

    if (!customer) {
        throw new Error(`Customer not found for mobile ${mobile}`);
    }

    return Number(customer.iMasterId);
}

/**
 * ===============================
 * GET BRANCH ID
 * ===============================
 */
async function getBranchId(code, fSessionId) {
    const res = await axios.get(
        `${FOCUS8_BASE_URL}/List/Masters/Core__branch`,
        { headers: { fSessionId } }
    );

    const branch = (res.data?.data || []).find(
        b => b.sCode?.toUpperCase() === code.toUpperCase()
    );

    if (!branch) {
        throw new Error(`Branch not found: ${code}`);
    }

    return Number(branch.iMasterId);
}

/**
 * ===============================
 * PUSH SALES ORDER TO FOCUS8
 * ===============================
 */

async function pushOrderToFocus8(order, user) {
    try {
    
        const fSessionId = await loginToFocus8();

        const CustomerAC__Id = await getCustomerAccountId(
            user.mobile,
            fSessionId
        );

        const Branch__Id = await getBranchId(
            FOCUS8_CONFIG.BRANCH_CODE,
            fSessionId
        );

        // ERP-approved constants
        const Entity__Id = 2;
        const Warehouse__Id = 3;

       
        const payload = {
            data: [{
                Header: {
                    CustomerAC__Id,
                    Branch__Id,
                    Entity__Id,
                    Warehouse__Id
                },
                Body: order.items.map(item => ({
                    Item__Id: Number(item._id),
                    Unit__Id: 1,
                    Quantity: item.quantity,
                    BaseQuantity: -item.quantity
                })),
                Footer: []
            }]
        };

        //  FINAL Focus Sales Order API CALL
        const response = await axios.post(
            `${FOCUS8_BASE_URL}/Transactions/Vouchers/Sales%20Order%20-%20Mobile%20App`,
            payload,
            { headers: { fSessionId } }
        );


        if (response.data?.result !== 1) {
            throw new Error(response.data?.message || "Focus8 voucher failed");
        }

        const voucher = response.data.data?.[0];

        logger.info(
            `FOCUS8 :: SUCCESS | OrderId=${order.orderId} | VoucherNo=${voucher.VoucherNo}`
        );

        return {
            success: true,
            voucherNo: voucher.VoucherNo,
            headerId: voucher.HeaderId,
            focus8Response: response.data   
        };

    } catch (error) {
        logger.error(
            `FOCUS8 :: FAILED | OrderId=${order.orderId} | Reason=${error.message}`
        );

        throw error;
    }
}


module.exports = {
    pushOrderToFocus8
};
