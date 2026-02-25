import { ConvexHttpClient } from "convex/browser";
// Import from dynamically generated code
// Note: We'll construct requests directly since it's cleaner in vanilla JS.
// We dynamically require the VITE_CONVEX_URL env.

const convexUrl = import.meta.env.VITE_CONVEX_URL || "https://formal-civet-526.convex.cloud";
if (!convexUrl) {
    console.warn("VITE_CONVEX_URL is not set. Please run 'npx convex dev' to start Convex and configure local dev.");
}

const client = new ConvexHttpClient(convexUrl);

// Fallback for gas login url
export const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/.../exec'; // Kept for legacy compatibility in UI
export const GAS_URL = localStorage.getItem('GAS_URL') || DEFAULT_GAS_URL;

export async function serverCall(action, payload = {}) {
    try {
        if (!convexUrl) throw new Error("Convex URL이 설정되지 않았습니다. 'npx convex dev'가 실행중인지 확인하세요.");

        switch (action) {
            case 'checkLogin':
                // Check passcode 
                const loginRes = await client.query("api:checkLogin", { passcode: payload.passcode });
                return loginRes;

            case 'getInitialData':
                const initRes = await client.query("api:getInitialData", {});
                return initRes;

            case 'createCustomer':
                const createRes = await client.mutation("api:createCustomer", { payload });
                return createRes;

            case 'updateCustomer':
                const updateRes = await client.mutation("api:updateCustomer", { payload });
                return updateRes;

            case 'deleteCustomer':
                const delRes = await client.mutation("api:deleteCustomer", { customerNo: payload.customerNo });
                return delRes;

            default:
                throw new Error(`지원하지 않는 액션입니다: ${action}`);
        }
    } catch (err) {
        console.error('Convex API Error:', err);
        throw new Error(`서버 연결 실패: ${err.message}`);
    }
}
