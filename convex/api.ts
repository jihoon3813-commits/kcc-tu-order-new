import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DATE_FIELDS = [
    "regDate",
    "applyDate",
    "constructDateFix",
    "esignDate",
    "paidDate",
    "balancePaidDate",
    "installmentContractDate",
    "recordingRequestDate",
    "deliveryDate",
    "birth",
];

function normalizeDate(val: any): string {
    if (!val) return "";
    let s = String(val).trim();
    if (!s || s === "null" || s === "undefined") return "";

    // 1. Check if it's already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // 2. Check if it's a 5-digit number (Excel serial)
    if (/^\d{5}(\.\d+)?$/.test(s)) {
        const serial = parseFloat(s);
        if (serial > 30000 && serial < 60000) {
            const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
            return date.toISOString().split('T')[0];
        }
    }

    // 3. Try parsing as a general date string
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        let year = d.getFullYear();
        let month = d.getMonth();
        let day = d.getDate();

        // Handle cases where the year is weird (like 46056 from mangled Excel serial)
        if (year > 3000) {
            // Try to extract a 5-digit serial from the string
            const match = s.match(/\b(\d{5})\b/);
            if (match) {
                const serial = parseFloat(match[1]);
                if (serial > 30000 && serial < 60000) {
                    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
                    return date.toISOString().split('T')[0];
                }
            }
            // If year is specifically something like 46056 and month is Jan and day is 1, 
            // it's almost certainly a serial that was used as a year
            if (month === 0 && day === 1 && year > 30000 && year < 60000) {
                const date = new Date(Math.round((year - 25569) * 86400 * 1000));
                return date.toISOString().split('T')[0];
            }
        }

        if (year > 9999) return s; // Too extreme

        const y = String(year).padStart(4, '0');
        const m = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        return `${y}-${m}-${dayStr}`;
    }

    return s;
}

// Mock auth query
export const checkLogin = query({
    args: { passcode: v.string() },
    handler: async (ctx, args) => {
        const storedPasscode = "xldb@@";
        if (args.passcode === storedPasscode) {
            return { ok: true };
        }
        console.log(`Login failed. Expected: ${storedPasscode}, Got: ${args.passcode}`);
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

        // Prepare fields matching schema
        const newDoc: any = {};
        for (const key of Object.keys(normalized)) {
            if (key.startsWith("_")) continue;
            let val = normalized[key];
            if (val !== null && val !== undefined) {
                if (DATE_FIELDS.includes(key)) {
                    newDoc[key] = normalizeDate(val);
                } else {
                    newDoc[key] = String(val);
                }
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
            let val = payload[key];
            if (val !== null && val !== undefined) {
                if (DATE_FIELDS.includes(key)) {
                    patchDoc[key] = normalizeDate(val);
                } else {
                    patchDoc[key] = String(val);
                }
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

export const fixAllDates = mutation({
    args: {},
    handler: async (ctx) => {
        const customers = await ctx.db.query("customers").collect();
        let fixCount = 0;
        for (const customer of customers) {
            const patch: any = {};
            let changed = false;
            for (const field of DATE_FIELDS) {
                const current = (customer as any)[field];
                if (current) {
                    const normalized = normalizeDate(current);
                    if (normalized !== current) {
                        patch[field] = normalized;
                        changed = true;
                    }
                }
            }
            if (changed) {
                await ctx.db.patch(customer._id, patch);
                fixCount++;
            }
        }
        return { ok: true, fixed: fixCount, total: customers.length };
    }
});

function makeCustomerNo() {
    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `C-${ts}-${rnd}`;
}
