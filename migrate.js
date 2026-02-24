import { ConvexHttpClient } from "convex/browser";
import fs from "fs";

// ⚠️ 사용 전 주의사항:
// 1. `npx convex dev`를 실행해서 백엔드를 먼저 활성화하세요.
const GAS_URL = 'https://script.google.com/macros/s/AKfycbykWmbvTcOz1V7RobkjcJavA2o_wgBZc4_nOBuhUQ_zuoFKv4Mz8njjefmn5p9yxuPy5w/exec';
const PASSCODE = 'xldb@@'; // or localstorage('kcc_passcode')

let CONVEX_URL = process.env.VITE_CONVEX_URL;

// Read .env.local if available
if (!CONVEX_URL && fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf-8');
    const match = envContent.match(/VITE_CONVEX_URL=(.+)/);
    if (match) {
        CONVEX_URL = match[1].trim();
    }
}

async function runMigrate() {
    if (!CONVEX_URL) {
        console.error("❌ CONVEX_URL을 찾을 수 없습니다. npx convex dev를 한 번 실행해서 .env.local이 생성되도록 하세요.");
        process.exit(1);
    }

    console.log('1. GAS 데이터 불러오기 시작...');
    const body = JSON.stringify({ action: 'getInitialData', passcode: PASSCODE });

    try {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });

        if (!response.ok) throw new Error("GAS 연결 에러");
        const data = await response.json();

        if (data.ok === false) {
            throw new Error(data.msg);
        }

        const { config, data: { customers } } = data;
        console.log(`성공: 설정(${Object.keys(config).length}개 항목), 고객(${customers.length}건)`);

        console.log('2. Convex로 마이그레이션 중...');
        const client = new ConvexHttpClient(CONVEX_URL);

        // Config 저장
        for (const key of Object.keys(config)) {
            await client.mutation("api:seedConfig", { key, value: config[key] });
            console.log(` - config: ${key} 저장 완료`);
        }

        // 고객 데이터 저장
        let count = 0;
        for (const cust of customers) {
            try {
                await client.mutation("api:createCustomer", { payload: cust });
                count++;
                if (count % 10 === 0) console.log(` - 고객 ${count}/${customers.length} 저장중...`);
            } catch (err) {
                console.error("고객 데이터 삽입 실패:", cust.customerNo, err.message);
                console.error("고객 데이터:", cust);
                throw err;
            }
        }

        console.log('🚀 마이그레이션이 성공적으로 완료되었습니다!');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

runMigrate();
