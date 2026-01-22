const axios = require("axios");
const logger = require("../utils/logger");
require("dotenv").config();

const FOCUS8_BASE_URL = process.env.FOCUS8_BASE_URL;
const FOCUS8_USERNAME = process.env.FOCUS8_USERNAME;
const FOCUS8_PASSWORD = process.env.FOCUS8_PASSWORD;
const FOCUS8_COMPANY_CODE = process.env.FOCUS8_COMPANY_CODE;

/**
 * ===============================
 * LOGIN TO FOCUS8
 * ===============================
 */
async function loginToFocus8() {
    const res = await axios.post(`${FOCUS8_BASE_URL}/login`, {
        url: null,
        data: [{
            UserName: FOCUS8_USERNAME,
            Password: FOCUS8_PASSWORD,
            CompanyCode: FOCUS8_COMPANY_CODE
        }]
    });

    if (!res.data?.data?.length) {
        throw new Error("Focus8 login failed");
    }

    return res.data.data[0].fSessionId;
}

let fSessionId = null;

/**
 * ===============================
 * FOCUS REQUEST WRAPPER (WITH RETRY)
 * ===============================
 */
async function focusRequest(url, data) {
    async function execute() {
        const sid = await getFocusSessionId();
        return await axios.post(url, data, { headers: { fSessionId: sid } });
    }

    let response = await execute();

    // Check for "Invalid Session" result
    if (
        response.data?.result === -1 &&
        response.data?.message?.toLowerCase().includes("invalid session")
    ) {
        logger.info("FOCUS8 :: Session invalid/expired. Retrying login...");
        fSessionId = null; // Clear cached session
        response = await execute();
    }

    return response;
}

async function getFocusSessionId() {
    fSessionId = '9Y0-2101202621462247128881042';
    if (!fSessionId) {
        console.log("FOCUS8 :: Logging in");
        fSessionId = await loginToFocus8();
        console.log("FOCUS8 :: Session id", fSessionId);
    }
    return fSessionId;
}

/**
 * ===============================
 * GET ORDER HEADER DATA
 * ===============================
 */
async function getOrderHeaderData(filters = {}) {
    const { mobile, sName, sCode } = filters;
    let query = `SELECT iMasterId, sName, sCode, BranchName, SalesmanName, DistrictsName FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5`;

    const conditions = [];
    // if (mobile) conditions.push(`sTelNo = '${mobile}'`);
    // if (sName) conditions.push(`sName = '${sName}'`);
    if (sCode) conditions.push(`sCode = '${sCode}'`);

    if (conditions.length > 0) {
        query += ` AND (${conditions.join(' OR ')})`;
    }

    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: query }]
        }
    );

    const accounts = res.data?.data?.[0]?.Table || [];
    const customer = accounts[0];

    if (!customer && (mobile || sName || sCode)) {
        throw new Error(`Customer not found with provided filters`);
    }

    if (!customer) {
        return null;
    }

    let Branch__Id = 0;
    let Salesman__Id = 0;
    let Districts__Id = 0;

    try {
        if (customer.BranchName) {
            Branch__Id = await getBranchId(customer.BranchName);
        }
    } catch (e) {
        logger.warn(`Failed to resolve Branch ID for ${customer.BranchName}, using fallback 0`);
    }

    try {
        if (customer.SalesmanName) {
            Salesman__Id = await getSalesmanId(customer.SalesmanName);
        }
    } catch (e) {
        logger.warn(`Failed to resolve Salesman ID for ${customer.SalesmanName}, using fallback 0`);
    }

    try {
        if (customer.DistrictsName) {
            Districts__Id = await getDistrictId(customer.DistrictsName);
        }
    } catch (e) {
        logger.warn(`Failed to resolve District ID for ${customer.DistrictsName}, using fallback 0`);
    }

    return {
        CustomerAC__Id: Number(customer.iMasterId),
        Branch__Id: Number(Branch__Id),
        Salesman__Id: Number(Salesman__Id),
        Districts__Id: Number(Districts__Id),
        IsIGST: 0
    };
}

/**
 * ===============================
 * GET BRANCH ID
 * ===============================
 */
async function getBranchId(branchName) {
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: `SELECT iMasterId, sName, sCode from mCore_Branch where istatus <>5 and sName = '${branchName}'` }]
        }
    );

    const branch = (res.data?.data?.[0]?.Table || []).find(
        b => b.sName?.toUpperCase() === branchName.toUpperCase()
    );

    if (!branch) {
        throw new Error(`Branch not found: ${branchName}`);
    }

    return Number(branch.iMasterId);
}

/**
 * ===============================
 * GET SALESMAN ID
 * ===============================
 */
async function getSalesmanId(salesmanName) {
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: `SELECT iMasterId, sName, sCode from mCore_salesman where istatus <>5 and sName = '${salesmanName}'` }]
        }
    );

    const salesman = (res.data?.data?.[0]?.Table || []).find(
        b => b.sName?.toUpperCase() === salesmanName.toUpperCase()
    );

    if (!salesman) {
        throw new Error(`Salesman not found: ${salesmanName}`);
    }

    return Number(salesman.iMasterId);
}

/**
 * ===============================
 * GET DISTRICT ID
 * ===============================
 */
async function getDistrictId(districtName) {
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: `SELECT iMasterId, sName, sCode from mCore_districts where istatus <>5 and sName = '${districtName}'` }]
        }
    );

    const district = (res.data?.data?.[0]?.Table || []).find(
        b => b.sName?.toUpperCase() === districtName.toUpperCase()
    );

    if (!district) {
        throw new Error(`District not found: ${districtName}`);
    }

    return Number(district.iMasterId);
}

/**
 * ===============================
 * GET PRODUCT MASTER
 * ===============================
 */
async function getProductMaster() {
    console.log("FOCUS8 :: Getting product master");
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: "SELECT iMasterId, sName, sCode from mCore_Product where istatus <>5" }]
        }
    );

    return res.data?.data?.[0]?.Table || [];
}

/**
 * ===============================
 * PUSH SALES ORDER TO FOCUS8
 * ===============================
 */
async function pushOrderToFocus8(order, user, entityId) {
    try {
        const {
            CustomerAC__Id,
            Branch__Id,
            Salesman__Id,
            Districts__Id,
            IsIGST
        } = await getOrderHeaderData({ mobile: user.mobile ?? null, sName: user.name ?? null, sCode: user.dealerCode ?? null });

        // Using IDs directly from order items (populated from ProductCatalog)
        const bodyItems = order.items.map(item => {
            return {
                Item__Id: item.focusProductId,
                Unit__Id: item.focusUnitId || 1,
                Quantity: item.quantity,
                Rate: item.productPrice,
            };
        });

        const Entity__Id = entityId;

        const payload = {
            data: [{
                Header: {
                    CustomerAC__Id,
                    Branch__Id,
                    Salesman__Id,
                    Districts__Id,
                    Entity__Id,
                    // Warehouse__Id,
                    'Company Name__Id': Entity__Id,
                    IsIGST
                },
                Body: bodyItems,
                Footer: []
            }]
        };

        const response = await focusRequest(
            `${FOCUS8_BASE_URL}/Transactions/Vouchers/Sales%20Order%20-%20Mobile%20App`,
            payload
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
    getProductMaster,
    pushOrderToFocus8
};
