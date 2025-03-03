const crypto = require ('crypto');

class PayoutWebhookEvent {
    constructor(type, rawBody, object) {
        this.type = type;
        this.raw = rawBody;
        this.object = object;
    }
}

class Cashfree {
    static XClientSecret = config.X_CLIENT_SECRET_QA;
    static XApiVersion = "2024-01-01";

    /**
     * Use this API to verify your webhook signature once you receive from Cashfree's server.
     * @summary Verify Webhook Signatures
     * @param {string} signature that is present in the header of the webhook ("x-webhook-signature")
     * @param {string} rawBody is the entire body sent to the server in string format
     * @param {string} timestamp that is present in the header of the webhook ("x-webhook-timestamp")
     * @throws {Error}
     */
    static PayoutVerifyWebhookSignature(signature, rawBody, timestamp) {
        const body = timestamp + rawBody;
        const secretKey = Cashfree.XClientSecret;
        let generatedSignature = crypto
            .createHmac("sha256", secretKey)
            .update(body)
            .digest("base64");
        if (generatedSignature === signature) {
            let jsonObject = JSON.parse(rawBody);
            return new PayoutWebhookEvent(jsonObject.type, rawBody, jsonObject);
        }
        throw new Error(
            "Generated signature and received signature did not match."
        );
    }
}

module.exports = Cashfree;
