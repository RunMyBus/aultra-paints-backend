const axios = require("axios");
const logger = require("../utils/logger");
const { normalizePhone } = require("../utils/CommonFuctions");
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
    try {
        const res = await axios.post(`${FOCUS8_BASE_URL}/login`, {
            url: null,
            data: [{
                UserName: FOCUS8_USERNAME,
                Password: FOCUS8_PASSWORD,
                CompanyCode: FOCUS8_COMPANY_CODE
            }]
        });

        if (!res.data?.data?.length) {
            logger.error("FOCUS8 :: Login failed - Unexpected response structure", { response: res.data });
            throw new Error("Focus8 login failed");
        }

        return res.data.data[0].fSessionId;
    } catch (error) {
        logger.error("FOCUS8 :: Login error", {
            message: error.message,
            response: error.response?.data
        });
        throw error;
    }
}

let fSessionId = null;

/**
 * ===============================
 * FOCUS REQUEST WRAPPER (WITH RETRY)
 * ===============================
 */
async function focusRequest(url, data) {
    async function execute() {
        try {
            const sid = await getFocusSessionId();
            return await axios.post(url, data, { headers: { fSessionId: sid } });
        } catch (error) {
            logger.error(`FOCUS8 :: HTTP request failed for ${url} | Error: ${error.message}`, {
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    const startTime = Date.now();
    let response;
    try {
        response = await execute();
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error(`FOCUS8 :: Request to ${url} failed after ${durationMs}ms`, { durationMs, url });
        throw error;
    }

    // Check for "Invalid Session" result
    if (
        (response.data?.result === -1 && response.data?.message?.toLowerCase().includes("invalid session")) ||
        (response.data?.result === 501 && response.data?.message?.toLowerCase().includes("not a valid session"))
    ) {
        logger.info("FOCUS8 :: Session invalid/expired. Retrying login...");
        fSessionId = null; // Clear cached session
        response = await execute();
    }

    const durationMs = Date.now() - startTime;
    logger.info(`FOCUS8 :: ${url} responded in ${durationMs}ms`, { durationMs, url, payload: data, result: response.data?.result });

    // Log unexpected responses (where result is not success)
    // result 1 is typically success for Focus 8 APIs
    if (response.data && response.data.result !== 1) {
        logger.warn(`FOCUS8 :: API returned non-success result from ${url}`, {
            result: response.data.result,
            message: response.data.message,
            fullResponse: response.data
        });
    }

    return response;
}

async function getFocusSessionId() {
    if (!fSessionId) {
        console.log("FOCUS8 :: Logging in");
        fSessionId = await loginToFocus8();
        console.log("FOCUS8 :: Session id", fSessionId);
    }
    return fSessionId;
}

// Focus 8's ExecuteSqlQuery accepts raw SQL, so every inlined value is a
// potential injection vector. Single-quote escaping is the minimum; callers
// should also prefer validated identifiers (sqlIdentifier) where applicable.
function sqlEscape(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/'/g, "''");
}
function sqlIdentifier(value) {
    // Conservative allowlist for opaque codes like dealerCode.
    const s = String(value || '').trim();
    if (!/^[A-Za-z0-9_\-./ ]{1,64}$/.test(s)) {
        throw new Error('Invalid identifier for Focus 8 query');
    }
    return s;
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
    if (sCode) conditions.push(`sCode = '${sqlEscape(sqlIdentifier(sCode))}'`);

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

    let Salesman__Id = 0;
    let Districts__Id = 0;

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
        Salesman__Id: Number(Salesman__Id),
        SalesmanName: customer.SalesmanName ? String(customer.SalesmanName).trim() : null, // route
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
            data: [{ Query: `SELECT iMasterId, sName, sCode from mCore_Branch where istatus <>5 and sName = '${sqlEscape(branchName)}'` }]
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
            data: [{ Query: `SELECT iMasterId, sName, sCode from mCore_salesman where istatus <>5 and sName = '${sqlEscape(salesmanName)}'` }]
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
            data: [{ Query: `SELECT iMasterId, sName, sCode from mCore_districts where istatus <>5 and sName = '${sqlEscape(districtName)}'` }]
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
 * GET ENTITY MASTER
 * ===============================
 */
async function getEntityMaster() {
    console.log("FOCUS8 :: Getting entity master");
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: "SELECT iMasterId, sName, sCode from mCore_Entity where istatus <>5" }]
        }
    );

    return res.data?.data?.[0]?.Table || [];
}

/**
 * ===============================
 * GET WAREHOUSE MASTER
 * ===============================
 */
async function getWarehouseMaster() {
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: "SELECT iMasterId, sName, sCode from mCore_Warehouse where istatus <>5" }]
        }
    );

    return res.data?.data?.[0]?.Table || [];
}

/**
 * ===============================
 * GET BRANCH MASTER
 * ===============================
 */
async function getBranchMaster() {
    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        {
            data: [{ Query: "SELECT iMasterId, sName, sCode from mCore_Branch where istatus <>5" }]
        }
    );

    return res.data?.data?.[0]?.Table || [];
}

/**
 * ===============================
 * GET ROUTE MASTER
 * ===============================
 * Returns the canonical list of routes from the Focus `Core__salesman` master,
 * one entry per route (sName). Normalization mirrors scripts/update-dealer-salesexec.js
 * so a route picked in the UI matches exactly what the sync/order flow resolves.
 */
async function getRouteMaster() {
    const sid = await getFocusSessionId();
    const res = await axios.get(`${FOCUS8_BASE_URL}/List/Masters/Core__salesman`, {
        headers: { fSessionId: sid }
    });

    const rows = res.data?.data || [];
    const routes = [];

    // No dedup by route name: the same route name can belong to different
    // salesmen, so every Core__salesman row is a distinct route option. The
    // admin disambiguates by the salesman name shown alongside the route.
    for (const sm of rows) {
        if (!sm.sName) continue;
        const routeName = String(sm.sName).trim();
        if (!routeName) continue;

        const salesExecutiveMobile = normalizePhone(sm.SalesManPhNO) || null;

        const salesmanName = sm.SalesmanName && String(sm.SalesmanName).trim()
            ? String(sm.SalesmanName).trim()
            : routeName;

        routes.push({ routeName, salesmanName, salesExecutiveMobile });
    }

    routes.sort((a, b) => a.routeName.localeCompare(b.routeName));
    return routes;
}

/**
 * ===============================
 * PUSH SALES ORDER TO FOCUS8
 * ===============================
 */
async function pushOrderToFocus8(order, user, { entityId, warehouseId, branchId, narration } = {}) {
    let payload;
    try {
        const {
            CustomerAC__Id,
            Salesman__Id,
            SalesmanName,
            Districts__Id,
            IsIGST
        } = await getOrderHeaderData({ mobile: user.mobile ?? null, sName: user.name ?? null, sCode: user.dealerCode ?? null });

        // Using IDs directly from order items (populated from ProductCatalog)
        const bodyItems = order.items.map(item => {
            return {
                Item__Id: item.focusProductId,
                // Unit__Id: item.focusUnitId || 1,
                Quantity: item.quantity,
                Rate: item.productPrice,
            };
        });

        const Entity__Id = entityId;
        const Branch__Id = branchId;
        const Warehouse__Id = warehouseId;

        const header = {
            CustomerAC__Id,
            Branch__Id,
            Salesman__Id,
            Districts__Id,
            Entity__Id,
            Warehouse__Id,
            'Company Name__Id': Entity__Id,
            IsIGST,
            MobileAppOrderId: order.orderId || ''
        };
        if (narration) header.sNarration = narration; //TODO: narration field name should be confirmed by focus

        payload = {
            data: [{
                Header: header,
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
            routeName: SalesmanName, // route name (display) — corresponds to Salesman__Id
            // Focus master references actually posted (grouped into focusRefs on the order).
            customerAccountId: CustomerAC__Id,
            salesmanId: Salesman__Id,
            districtsId: Districts__Id,
            isIGST: IsIGST,
            focus8Response: response.data
        };

    } catch (error) {
        logger.error(
            `FOCUS8 :: FAILED | OrderId=${order.orderId} | Reason=${error.message}`,
            {
                orderId: order.orderId,
                errorMessage: error.message,
                errorResponse: error.response?.data || 'No response data',
                payload: payload,
                orderData: {
                    items: order.items,
                    user: {
                        mobile: user.mobile,
                        name: user.name,
                        dealerCode: user.dealerCode
                    },
                    entityId: entityId
                }
            }
        );

        throw error;
    }
}


/**
 * ===============================
 * FORMAT DATE FOR FOCUS8 SQL (DD-MM-YYYY)
 * ===============================
 */
function formatDateForFocus8(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * ===============================
 * GET SO MOBILE APP ORDERS (LAST 6 MONTHS)
 * ===============================
 */
async function getSOMobileAppOrders() {
    const today = formatDateForFocus8(new Date());
    const query = `SELECT * FROM udv_SOMobileApp WHERE CONVERT(DATE, [Date], 105) BETWEEN DATEADD(MONTH, -6, CONVERT(DATE, '${today}', 105)) AND CONVERT(DATE, '${today}', 105) ORDER BY CONVERT(DATE, [Date], 105) DESC`;

    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        { data: [{ Query: query }] }
    );

    return res.data?.data?.[0]?.Table || [];
}

/**
 * ===============================
 * GET DC INVOICE ROWS FOR AN ORDER
 * ===============================
 * Fetches delivery challan rows for a given order within a 15-day window
 * after the order creation date.
 * Links via MobileAppOrderId (primary).
 */
async function getDCInvoiceForOrder(mobileAppOrderId, orderDate) {
    const formattedDate = formatDateForFocus8(orderDate);
    const conditions = [];
    if (mobileAppOrderId) conditions.push(`MobileAppOrderId = '${mobileAppOrderId}'`);
    const whereClause = conditions.length ? `AND (${conditions.join(' OR ')})` : '';

    const query = `SELECT * FROM udv_DCInvoice WHERE CONVERT(DATE, [Date], 105) BETWEEN CONVERT(DATE, '${formattedDate}', 105) AND DATEADD(DAY, 15, CONVERT(DATE, '${formattedDate}', 105)) ${whereClause}`;

    const res = await focusRequest(
        `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
        { data: [{ Query: query }] }
    );

    return res.data?.data?.[0]?.Table || [];
}

/**
 * ===============================
 * GET PRICEBOOK DATA
 * ===============================
 * Fetches dealer-specific pricing from Focus8 pricebook
 * @returns {Array} Array of price records with iProductId, iAccountId, fVal1, iStartDate, etc.
 */
async function getPriceBookData() {
    try {
        const query = `select iProductId, iAccountId, fVal1, iStartDate, iPriceBookId from Udv_SellingPriceBookDetails;`;
        
        logger.info(`FOCUS8 :: Fetching pricebook data.`);
        
        const res = await focusRequest(
            `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
            {
                data: [{ Query: query }]
            }
        );

        const priceRecords = res.data?.data?.[0]?.Table || [];
        
        logger.info(`FOCUS8 :: Retrieved ${priceRecords.length} price records from pricebook`);
        
        return priceRecords;
    } catch (error) {
        logger.error("FOCUS8 :: Error fetching pricebook data", {
            message: error.message,
            response: error.response?.data
        });
        // Return empty array on error to allow fallback to catalog prices
        return [];
    }
}

/**
 * ===============================
 * GET DEALER ACCOUNT ID FROM FOCUS8
 * ===============================
 * Fetches the Focus8 iMasterId (account ID) for a dealer by their dealer code
 * @param {string} dealerCode - The dealer's code
 * @returns {number|null} The iMasterId or null if not found
 */
async function getDealerAccountId(dealerCode) {
    try {
        if (!dealerCode) {
            return null;
        }

        const query = `SELECT iMasterId FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5 AND sCode = '${sqlEscape(sqlIdentifier(dealerCode))}'`;
        
        const res = await focusRequest(
            `${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`,
            {
                data: [{ Query: query }]
            }
        );

        const accounts = res.data?.data?.[0]?.Table || [];
        
        if (accounts.length > 0) {
            logger.info(`FOCUS8 :: Found account ID ${accounts[0].iMasterId} for dealer code ${dealerCode}`);
            return Number(accounts[0].iMasterId);
        }
        
        logger.warn(`FOCUS8 :: No account found for dealer code ${dealerCode}`);
        return null;
    } catch (error) {
        logger.error("FOCUS8 :: Error fetching dealer account ID", {
            dealerCode,
            message: error.message,
            response: error.response?.data
        });
        return null;
    }
}

/**
 * ===============================
 * GET DEALER FINANCIAL DATA FROM FOCUS8
 * ===============================
 * Fetches closing balance and credit limit for a dealer by their dealer code
 * @param {string} dealerCode - The dealer's code
 * @returns {{ closingBalance: number|null, creditLimit: number|null }}
 */
async function getDealerFinancialData(dealerCode) {
    if (!dealerCode) return { closingBalance: null, creditLimit: null };

    const [balanceRes, creditRes] = await Promise.allSettled([
        focusRequest(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: `SELECT ClosingBalance FROM udv_customerBalance WHERE [Account Code] = '${dealerCode}'` }]
        }),
        focusRequest(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: `SELECT fCreditLimit FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5 AND sCode = '${dealerCode}'` }]
        })
    ]);

    const closingBalance = balanceRes.status === 'fulfilled'
        ? (balanceRes.value.data?.data?.[0]?.Table?.[0]?.ClosingBalance ?? null)
        : null;

    const creditLimit = creditRes.status === 'fulfilled'
        ? (creditRes.value.data?.data?.[0]?.Table?.[0]?.fCreditLimit ?? null)
        : null;

    return { closingBalance, creditLimit };
}

module.exports = {
    getProductMaster,
    getEntityMaster,
    getWarehouseMaster,
    getBranchMaster,
    getRouteMaster,
    pushOrderToFocus8,
    getPriceBookData,
    getDealerAccountId,
    getDealerFinancialData,
    getSOMobileAppOrders,
    getDCInvoiceForOrder
};
