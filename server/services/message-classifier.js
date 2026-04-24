/**
 * message-classifier.js
 *
 * Classifies inbound customer messages into action categories
 * Uses keyword matching to determine customer intent
 */

/**
 * Classifies a message based on keywords
 * @param {string} body - Message body text
 * @param {string} subject - Optional email subject line
 * @returns {Object} { classification, confidence, keywords_matched }
 */
function classifyMessage(body, subject = "") {
    const text = `${body} ${subject}`.toLowerCase();

    // Classification patterns with keywords and confidence levels
    const patterns = {
        NOTICE_NOT_RECEIVED: {
            keywords: [
                "haven't received", "hasn't arrived", "didn't get", "not received",
                "haven't gotten", "waiting for notice", "no notice yet",
                "still waiting", "never got", "never received", "not arrived"
            ],
            confidence: "high"
        },
        WRONG_DOCUMENT: {
            keywords: [
                "tax bill", "payment", "paid my taxes", "property tax bill",
                "wrong form", "wrong document", "sent the bill", "attached bill",
                "tax statement", "billing statement", "annual bill"
            ],
            confidence: "high"
        },
        DOCUMENT_RECEIVED: {
            keywords: [
                "uploaded", "sent you", "attached", "here is", "here's",
                "attached the", "sending you", "i sent", "just sent",
                "notice attached", "see attached", "document attached",
                "photo attached", "picture attached", "image attached",
                "forwarded", "forwarding"
            ],
            confidence: "high"
        },
        SIGNATURE_PENDING: {
            keywords: [
                "sign", "signature", "agreement", "authorize", "authorization",
                "docusign", "esign", "electronic signature", "need to sign",
                "signing", "haven't signed", "when can i sign", "ready to sign",
                "can't sign", "problem signing", "link expired", "sign later"
            ],
            confidence: "high"
        }
    };

    // Check each pattern
    for (const [classification, { keywords, confidence }] of Object.entries(patterns)) {
        const matched = keywords.filter(kw => text.includes(kw));

        if (matched.length > 0) {
            // Adjust confidence based on number of matches
            let finalConfidence = confidence;
            if (matched.length === 1 && text.length < 30) {
                finalConfidence = "medium";
            } else if (matched.length >= 2) {
                finalConfidence = "high";
            }

            return {
                classification,
                confidence: finalConfidence,
                keywords_matched: matched
            };
        }
    }

    // Default: general question
    return {
        classification: "GENERAL_QUESTION",
        confidence: "medium",
        keywords_matched: []
    };
}

module.exports = { classifyMessage };
