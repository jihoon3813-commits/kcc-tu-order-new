import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    customers: defineTable({
        customerNo: v.string(),
        no: v.optional(v.union(v.string(), v.number())),
        branch: v.optional(v.string()),
        regDate: v.optional(v.string()),
        applyDate: v.optional(v.string()),
        inflowChannel: v.optional(v.string()),
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        address: v.optional(v.string()),
        birth: v.optional(v.string()),
        memoQuick: v.optional(v.string()),
        constructConfirm: v.optional(v.string()),
        constructDateFix: v.optional(v.string()),
        esignStatus: v.optional(v.string()),
        esignDate: v.optional(v.string()),
        payMethod: v.optional(v.string()),
        finalQuote: v.optional(v.union(v.number(), v.string())),
        plusYn: v.optional(v.string()),
        kccSupplyPrice: v.optional(v.union(v.number(), v.string())),
        kccDepositStatus: v.optional(v.string()),
        paidAmount: v.optional(v.union(v.number(), v.string())),
        paidDate: v.optional(v.string()),
        balanceAmount: v.optional(v.union(v.number(), v.string())),
        balancePaidDate: v.optional(v.string()),
        interestYn: v.optional(v.string()),
        subTotalFee: v.optional(v.union(v.number(), v.string())),
        subMonths: v.optional(v.union(v.number(), v.string())),
        subMonthlyFee: v.optional(v.union(v.number(), v.string())),
        subApprove: v.optional(v.string()),
        hankaeFeedback: v.optional(v.string()),
        installmentContractDate: v.optional(v.string()),
        recordingRequestDate: v.optional(v.string()),
        plusProduct: v.optional(v.string()),
        plusModel: v.optional(v.string()),
        deliveryDate: v.optional(v.string()),
        memo: v.optional(v.string()),
    }).index("by_customerNo", ["customerNo"])
        .index("by_regDate", ["regDate"]),

    config: defineTable({
        key: v.string(),
        value: v.any(),
    }).index("by_key", ["key"]),
});
