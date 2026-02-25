import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Mock auth query
export const checkLogin = query({
    args: { passcode: v.string() },
    handler: async (ctx, args) => {
        const storedPasscode = process.env.KCC_PASSCODE || "xldb@@";
        if (args.passcode === storedPasscode) {
            return { ok: true };
        }
        return { ok: false, msg: "비밀번호가 올바르지 않습니다." };
    }
});

export const getInitialData = query({
    args: {},
    handler: async (ctx) => {
        // Get all configs format: { branches: [], payMethods: [], ... }
        const configDocs = await ctx.db.query("config").collect();
        const configData: any = {
            branches: ['종합', '인천', '수원'],
            esignStatusList: ['진행대기', '발송완료', '서명완료', '계약취소'],
            constructConfirmList: ['대기', '완료', '취소', '한캐불가'],
            kccDepositStatusList: ['입금대기', '입금완료', '계약취소'],
            subApproveList: ['대기', '승인', '정밀', '불가'],
            hankaeFeedbackList: ['대기', '진행', '불가'],
            payMethods: ['현금', '카드', '카드+현금', '구독(할부)', '현금+구독', '카드+구독', '50/50(현금)', '50/50(카드)'],
            inflowChannels: [],
            plusProducts: [],
            banners: []
        };

        // Apply overriding config from DB if exists
        for (const doc of configDocs) {
            configData[doc.key] = doc.value;
        }

        const customers = await ctx.db.query("customers").order("desc").collect();

        // Strip `_id` and `_creationTime` to map exactly to previous API
        const cleanCustomers = customers.map(c => {
            const { _id, _creationTime, ...rest } = c;
            return rest;
        });

        return {
            config: configData,
            data: { customers: cleanCustomers }
        };
    }
});

export const createCustomer = mutation({
    args: { payload: v.any() },
    handler: async (ctx, args) => {
        const { payload } = args;
        const customerNo = payload.customerNo || makeCustomerNo();
        const normalized = { ...payload, customerNo };

        if (!normalized.regDate && normalized.applyDate) {
            normalized.regDate = normalized.applyDate;
        }

        // Prepare fields matching schema (omitting unneeded ones)
        const newDoc: any = {};
        for (const key of Object.keys(normalized)) {
            if (key.startsWith("_")) continue;
            if (normalized[key] !== null && normalized[key] !== undefined) {
                newDoc[key] = String(normalized[key]); // simplistic normalization
            }
        }
        newDoc.customerNo = customerNo; // ensure

        const existing = await ctx.db
            .query("customers")
            .withIndex("by_customerNo", (q) => q.eq("customerNo", customerNo))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, newDoc);
        } else {
            await ctx.db.insert("customers", newDoc);
        }
        return { ok: true, customerNo };
    }
});

export const updateCustomer = mutation({
    args: { payload: v.any() },
    handler: async (ctx, args) => {
        const { payload } = args;
        const customerNo = payload.customerNo;
        if (!customerNo) throw new Error("customerNo is required");

        const existing = await ctx.db
            .query("customers")
            .withIndex("by_customerNo", (q) => q.eq("customerNo", customerNo))
            .first();

        if (!existing) throw new Error("해당 고객번호를 찾을 수 없습니다.");

        if (!payload.regDate && payload.applyDate) {
            payload.regDate = payload.applyDate;
        }

        const patchDoc: any = {};
        for (const key of Object.keys(payload)) {
            if (key.startsWith("_")) continue;
            if (payload[key] !== null && payload[key] !== undefined) {
                patchDoc[key] = String(payload[key]);
            }
        }

        // Safety
        delete patchDoc._id;
        delete patchDoc._creationTime;

        await ctx.db.patch(existing._id, patchDoc);
        return { ok: true };
    }
});

export const deleteCustomer = mutation({
    args: { customerNo: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("customers")
            .withIndex("by_customerNo", (q) => q.eq("customerNo", args.customerNo))
            .first();

        if (!existing) throw new Error("삭제할 대상을 찾을 수 없습니다.");

        await ctx.db.delete(existing._id);
        return { ok: true };
    }
});

export const seedConfig = mutation({
    args: { key: v.string(), value: v.any() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("config")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, { value: args.value });
        } else {
            await ctx.db.insert("config", { key: args.key, value: args.value });
        }
        return { ok: true };
    }
});

function makeCustomerNo() {
    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `C-${ts}-${rnd}`;
}
