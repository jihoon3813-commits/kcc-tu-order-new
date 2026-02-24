import { serverCall, GAS_URL, DEFAULT_GAS_URL } from './api.js';

/**
 * State Management
 */
let state = {
    isLoggedIn: false,
    config: {},
    customers: [],
    tab: 'dashboard',
    dashRangeMonths: 6,
    listRangeMonths: 6,
    listCardCols: localStorage.getItem('listCardCols') || '2',
    listGroupBy: localStorage.getItem('listGroupBy') || 'none',
    activeListFilter: null,
    carryPeriod: null,
    editing: null,
    isCreate: false,
    calDate: new Date()
};

/**
 * DOM Utils
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const todayYMD = () => new Date().toISOString().slice(0, 10);
const parseYMD = (s) => { const t = String(s || '').trim(); if (!t) return null; const d = new Date(t); return isNaN(d) ? null : d; };
const formatDate = (s) => {
    const t = String(s || '').trim();
    if (!t) return '';
    // If it's already YYYY-MM-DD, return it
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    // Try to parse as Date
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/**
 * Money Formatting
 */
const _digitsOnly = (v) => String(v || '').replace(/[^0-9]/g, '');
const formatMoneyValue = (v) => {
    const d = _digitsOnly(v);
    if (!d) return '';
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const toNumber = (v) => { const d = _digitsOnly(v); return d ? Number(d) : 0; };
const fmtMoney = (v) => formatMoneyValue(v);

function formatAllMoneyInputs() {
    document.querySelectorAll('.money-input').forEach(el => {
        el.value = formatMoneyValue(el.value);
    });
}

function formatMoneyInput(el) { el.value = formatMoneyValue(el.value); }

function bindMoneyInputs() {
    document.querySelectorAll('.money-input').forEach(input => {
        if (input.dataset.moneyBound === '1') return;
        input.dataset.moneyBound = '1';
        input.addEventListener('input', () => formatMoneyInput(input));
        input.addEventListener('blur', () => formatMoneyInput(input));
    });
}

// Duplicate functions removed. Use the ones defined in lines 46-54.

/**
 * UI State Utils
 */
function busy(on, text) {
    const el = $('busy');
    const t = $('busyText');
    if (text) t.innerText = text;
    if (on) {
        el.classList.remove('hidden');
        el.classList.add('flex');
    } else {
        el.classList.add('hidden');
        el.classList.remove('flex');
    }
}

/**
 * Business Logic (Migrated from original)
 */
const isSub = (c) => String(c.payMethod || '') === '구독(할부)';
const isEsignDone = (c) => String(c.esignStatus || '') === '서명완료';
const isCancelled = (c) => String(c.esignStatus || '') === '계약취소' || String(c.kccDepositStatus || '') === '계약취소';
const isConstructionDone = (c) => {
    if (!isEsignDone(c)) return false;
    const d = parseYMD(c.constructDateFix);
    if (!d) return false;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return d < now;
};
const isContractComplete = (c) => {
    if (!isEsignDone(c)) return false;
    if (isCancelled(c)) return false;
    if (isConstructionDone(c)) return false;
    return String(c.constructConfirm || '') === '완료';
};
const isContractInProgress = (c) => {
    if (!isEsignDone(c)) return false;
    if (isCancelled(c)) return false;
    if (isConstructionDone(c)) return false;
    const v = String(c.constructConfirm || '').trim();
    return (v === '대기' || v === '');
};
const isUnordered = (c) => {
    if (isCancelled(c)) return false;
    if (!isEsignDone(c)) return false;
    return String(c.kccDepositStatus || '') !== '입금완료';
};
const isCashDepositMissing = (c) => {
    if (isSub(c)) return false;
    if (isCancelled(c)) return false;
    return isEsignDone(c) && !String(c.paidDate || '').trim();
};
const isCashBalanceMissing_Done = (c) => {
    if (isCancelled(c)) return false;
    if (isSub(c)) return false;
    if (!isEsignDone(c)) return false;
    const bal = toNumber(c.balanceAmount);
    if (!bal) return false;
    return !String(c.balancePaidDate || '').trim();
};
const isConstructionUnconfirmed = (c) => {
    if (isCancelled(c)) return false;
    const hf = String(c.hankaeFeedback || '');
    if (hf.includes('불가')) return false;
    return String(c.constructConfirm || '') !== '완료';
};
const isEsignNotApproved = (c) => {
    if (isCancelled(c)) return false;
    return String(c.esignStatus || '') === '발송완료';
};
const isHankaeWait = (c) => {
    if (isCancelled(c)) return false;
    if (!isSub(c)) return false;
    if (String(c.subApprove || '') !== '승인') return false;
    return String(c.hankaeFeedback || '') !== '진행';
};
const isInstallmentIncomplete = (c) => {
    if (!isSub(c)) return false;
    if (String(c.hankaeFeedback || '') !== '진행') return false;
    return !String(c.recordingRequestDate || '').trim();
};

/**
 * filtering
 */
function filterByPeriod(list, mode, year, month, rangeMonths) {
    if (mode === 'all') return list.slice();
    if (mode === 'year') {
        return list.filter(c => c.regDate && c.regDate.startsWith(String(year)));
    }
    if (mode === 'month') {
        const ym = `${year}-${month}`;
        return list.filter(c => c.regDate && c.regDate.startsWith(ym));
    }

    // Range Mode
    const n = Number(rangeMonths);
    if (n === 0) {
        // Current Month (This Calendar Month)
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return list.filter(c => c.regDate && c.regDate.startsWith(ym));
    }

    // Last N Months (Rolling)
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    d.setHours(0, 0, 0, 0);
    return list.filter(c => {
        const cd = parseYMD(c.regDate);
        return cd && cd >= d;
    });
}

/**
 * Authentication
 */
async function login() {
    // Force use DEFAULT_GAS_URL if input is empty or hidden
    const inputUrl = $('gasUrl') ? $('gasUrl').value.trim() : "";
    const gasUrl = inputUrl || DEFAULT_GAS_URL;
    const pw = $('pw').value.trim();

    if (!pw) return alert('Passcode를 입력해주세요.');

    $('loginMsg').innerText = '접속 시도 중...';
    $('loginBusy').classList.remove('hidden');

    try {
        const res = await serverCall('checkLogin', { gasUrl, passcode: pw });
        if (res && res.ok) {
            localStorage.setItem('GAS_URL', gasUrl);
            localStorage.setItem('kcc_passcode', pw);
            localStorage.setItem('kcc_auth_ts', Date.now());

            $('login').classList.add('hidden');
            $('app').classList.remove('hidden');
            state.isLoggedIn = true;
            await reloadAll(true);
            switchTab('dashboard', false);
        } else {
            $('loginMsg').innerText = res.msg || '로그인 실패';
        }
    } catch (e) {
        $('loginMsg').innerText = e.message;
    } finally {
        $('loginBusy').classList.add('hidden');
    }
}

/**
 * Data Management
 */
async function reloadAll(initial) {
    if (initial) { state.activeListFilter = null; state.carryPeriod = null; }
    try {
        const res = await serverCall('getInitialData');
        state.config = res.config || {};
        state.customers = (res.data && res.data.customers) ? res.data.customers.map(c => ({
            ...c,
            regDate: formatDate(c.regDate),
            applyDate: formatDate(c.applyDate),
            birth: formatDate(c.birth),
            esignDate: formatDate(c.esignDate),
            constructDateFix: formatDate(c.constructDateFix),
            paidDate: formatDate(c.paidDate),
            balancePaidDate: formatDate(c.balancePaidDate),
            installmentContractDate: formatDate(c.installmentContractDate),
            recordingRequestDate: formatDate(c.recordingRequestDate),
            deliveryDate: formatDate(c.deliveryDate)
        })) : [];
        renderBanners();
        initSelectors();
        if (initial) {
            $('dashMode').value = 'range'; state.dashRangeMonths = 6;
            $('listMode').value = 'range'; state.listRangeMonths = 6;
        }
        renderDashboardInteractive();
        renderList();
        if (state.tab === 'calendar') renderCalendar();
    } catch (err) {
        alert('데이터 연동 오류: ' + err.message);
    }
}

function initSelectors() {
    const years = Array.from(new Set(state.customers.map(c => String(c.regDate || '').slice(0, 4)).filter(Boolean))).sort();
    const nowY = String(new Date().getFullYear());
    if (!years.includes(nowY)) years.push(nowY);
    years.sort();

    fillSelect('dashYear', years);
    fillSelect('listYear', years);

    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    fillSelect('dashMonth', months);
    fillSelect('listMonth', months);

    $('dashYear').value = nowY;
    $('listYear').value = nowY;
    $('dashMonth').value = String(new Date().getMonth() + 1).padStart(2, '0');
    $('listMonth').value = String(new Date().getMonth() + 1).padStart(2, '0');

    // filters
    fillSelect('fBranch', state.config.branches || [], '지점 전체');
    fillSelect('fChannel', state.config.inflowChannels || [], '유입채널 전체');
    fillSelect('fPay', state.config.payMethods || [], '결제방법 전체');
    fillSelect('fEsign', state.config.esignStatusList || [], '전자서명 전체');
    fillSelect('fSubApprove', state.config.subApproveList || [], '구독승인 전체');
    fillSelect('fHankae', state.config.hankaeFeedbackList || [], '한캐피드백 전체');

    // modal
    fillSelect('f-branch', state.config.branches || [], '(미선택)');
    fillSelect('f-inflowChannel', state.config.inflowChannels || [], '(미선택)');
    fillSelect('f-constructConfirm', state.config.constructConfirmList || [], '(미선택)');
    fillSelect('f-esignStatus', state.config.esignStatusList || [], '(미선택)');
    fillSelect('f-payMethod', state.config.payMethods || [], '(미선택)');
    fillSelect('f-kccDepositStatus', state.config.kccDepositStatusList || [], '(미선택)'); // NEW
    fillSelect('f-subApprove', state.config.subApproveList || [], '(미선택)');
    fillSelect('f-hankaeFeedback', state.config.hankaeFeedbackList || [], '(미선택)');
    fillSelect('f-plusProduct', state.config.plusProducts || [], '(미선택)');
}

function fillSelect(id, arr, placeholder) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = '';
    if (placeholder) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = placeholder;
        el.appendChild(o);
    }
    arr.forEach(v => {
        if (v === '' || v == null) return;
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = String(v);
        el.appendChild(o);
    });
}

/**
 * Navigation
 */
function switchTab(tab, shouldReload = true, fromDashboard = false) {
    state.tab = tab;
    $('topTitle').innerText = tab === 'dashboard' ? '대시보드' : tab === 'list' ? '고객리스트' : '시공달력';
    $('topSub').innerText = tab === 'dashboard' ? '최근 6개월 데이터 기준 실적 분석' : '전체 계약 고객 현황 관리';

    document.querySelectorAll('.navBtn').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('bg-white/10', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('shadow-lg', active);
    });

    ['dashboard', 'list', 'calendar'].forEach(t => {
        const sec = $('page-' + t);
        if (sec) sec.classList.toggle('hidden', t !== tab);
    });

    if (tab === 'list' && !fromDashboard) {
        state.activeListFilter = null;
        state.carryPeriod = null;
    }

    if (shouldReload && state.isLoggedIn) {
        reloadAll(false);
    }

    if (tab === 'calendar') renderCalendar();
}

/**
 * Dashboard Rendering
 */
function renderDashboardInteractive() {
    const mode = $('dashMode').value;
    const year = $('dashYear').value;
    const month = $('dashMonth').value;
    const range = (mode === 'range') ? state.dashRangeMonths : 0;
    const base = filterByPeriod(state.customers, mode, year, month, range);

    const signed = base.filter(isEsignDone);
    const doneList = signed.filter(isConstructionDone);
    const completeList = signed.filter(isContractComplete);
    const progressList = signed.filter(isContractInProgress);
    const cancelList = base.filter(isCancelled);

    // Performance Cards
    const perfData = [
        { label: '총 등록', key: 'total', val: base.length, cash: base.filter(c => !isSub(c)).length, sub: base.filter(isSub).length, tone: 'text-slate-900', icon: 'fa-folder-plus' },
        { label: '공사완료', key: 'done', val: doneList.length, cash: doneList.filter(c => !isSub(c)).length, sub: doneList.filter(isSub).length, tone: 'text-indigo-600', icon: 'fa-check-double' },
        { label: '계약완료', key: 'complete', val: completeList.length, cash: completeList.filter(c => !isSub(c)).length, sub: completeList.filter(isSub).length, tone: 'text-emerald-500', icon: 'fa-circle-check' },
        { label: '계약진행', key: 'progress', val: progressList.length, cash: progressList.filter(c => !isSub(c)).length, sub: progressList.filter(isSub).length, tone: 'text-amber-500', icon: 'fa-spinner' },
        { label: '계약취소', key: 'cancel', val: cancelList.length, cash: cancelList.filter(c => !isSub(c)).length, sub: cancelList.filter(isSub).length, tone: 'text-rose-500', icon: 'fa-ban' }
    ];

    $('dashPerf').innerHTML = perfData.map(d => `
    <div class="premium-card bg-white p-6 rounded-3xl shadow-sm cursor-pointer group" onclick="onDashPerfClick('${d.key}', 'all')">
      <div class="flex items-start justify-between">
        <div class="space-y-1">
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${d.label}</div>
          <div class="text-3xl font-black ${d.tone}">${d.val}</div>
        </div>
        <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-all">
          <i class="fas ${d.icon} text-lg"></i>
        </div>
      </div>
      <div class="mt-4 flex gap-4 border-t border-slate-50 pt-4">
        <div class="flex-1">
          <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">CASH</div>
          <div class="text-xs font-bold text-slate-600">${d.cash}</div>
        </div>
        <div class="flex-1">
          <div class="text-[9px] font-black text-slate-400 uppercase tracking-tighter">SUBS</div>
          <div class="text-xs font-bold text-slate-600">${d.sub}</div>
        </div>
      </div>
    </div>
  `).join('');

    // Revenue Cards
    const sumFinal = (list) => list.reduce((a, c) => a + toNumber(c.finalQuote), 0);
    const salesData = [
        { label: '총 매출', val: sumFinal(base), cash: sumFinal(base.filter(c => !isSub(c))), sub: sumFinal(base.filter(isSub)), tone: 'text-slate-900' },
        { label: '공사 매출', val: sumFinal(doneList), cash: sumFinal(doneList.filter(c => !isSub(c))), sub: sumFinal(doneList.filter(isSub)), tone: 'text-indigo-600' },
        { label: '계약 매출', val: sumFinal(completeList), cash: sumFinal(completeList.filter(c => !isSub(c))), sub: sumFinal(completeList.filter(isSub)), tone: 'text-emerald-500' },
        { label: '예정 매출', val: sumFinal(progressList), cash: sumFinal(progressList.filter(c => !isSub(c))), sub: sumFinal(progressList.filter(isSub)), tone: 'text-amber-500' },
        { label: '취소 매출', val: sumFinal(cancelList), cash: sumFinal(cancelList.filter(c => !isSub(c))), sub: sumFinal(cancelList.filter(isSub)), tone: 'text-rose-500' }
    ];

    $('dashSales').innerHTML = salesData.map(d => `
    <div class="premium-card bg-white p-6 rounded-3xl shadow-sm">
      <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">${d.label}</div>
      <div class="text-xl font-black ${d.tone}">₩ ${fmtMoney(d.val)}</div>
      <div class="mt-4 grid grid-cols-2 gap-2 border-t border-slate-50 pt-4">
        <div>
          <span class="text-[9px] font-black text-slate-400 block uppercase">Cash</span>
          <span class="text-[11px] font-bold text-slate-600">${fmtMoney(d.cash)}</span>
        </div>
        <div>
          <span class="text-[9px] font-black text-slate-400 block uppercase">Subs</span>
          <span class="text-[11px] font-bold text-slate-600">${fmtMoney(d.sub)}</span>
        </div>
      </div>
    </div>
  `).join('');

    renderDashTasks(base);
    renderDashTimeline();
}

/**
 * Task Management
 */
function renderDashTasks(base) {
    const tasks = [
        { key: 'balance_missing', title: '잔금 확인', count: base.filter(isCashBalanceMissing_Done).length, tone: 'text-rose-400', bg: 'bg-rose-500/10' },
        { key: 'deposit_missing', title: '입금 확인', count: base.filter(isCashDepositMissing).length, tone: 'text-amber-400', bg: 'bg-amber-500/10' },
        { key: 'unordered', title: '미발주', count: base.filter(isUnordered).length, tone: 'text-indigo-400', bg: 'bg-indigo-500/10' },
        { key: 'construct_unconfirmed', title: '시공 미확정', count: base.filter(isConstructionUnconfirmed).length, tone: 'text-slate-400', bg: 'bg-slate-500/10' },
        { key: 'esign_pending', title: '계약서 미승인', count: base.filter(isEsignNotApproved).length, tone: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        { key: 'hankae_wait', title: '한캐승인대기', count: base.filter(isHankaeWait).length, tone: 'text-blue-400', bg: 'bg-blue-500/10' },
        { key: 'installment_incomplete', title: '할부계약 미완료', count: base.filter(isInstallmentIncomplete).length, tone: 'text-pink-400', bg: 'bg-pink-500/10' }
    ];

    $('dashTasks').innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${tasks.map(t => `
                <div class="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-pointer group" onclick="onDashTaskClick('${t.key}')">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${t.bg} flex items-center justify-center ${t.tone}">
                            <i class="fas fa-exclamation-triangle text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-white/90 group-hover:text-white transition-all">${t.title}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-xl font-black text-white">${t.count}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderDashTimeline() {
    const now = new Date();
    const months = [
        new Date(now.getFullYear(), now.getMonth() - 1, 1),
        new Date(now.getFullYear(), now.getMonth(), 1),
        new Date(now.getFullYear(), now.getMonth() + 1, 1)
    ];
    const ids = ['mPrev', 'mCur', 'mNext'];
    const labels = ['mPrevT', 'mCurT', 'mNextT'];

    months.forEach((d, i) => {
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        $(labels[i]).innerText = `${d.getFullYear()}.${d.getMonth() + 1}`;

        const items = state.customers
            .filter(c => String(c.constructDateFix || '').startsWith(ym))
            .sort((a, b) => String(a.constructDateFix).localeCompare(b.constructDateFix))
            .slice(0, 5);

        $(ids[i]).innerHTML = items.length ? items.map(c => `
      <div class="p-3 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all cursor-pointer group" onclick="openModalByNo('${c.customerNo}')">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-black text-slate-800">${esc(c.name)}</span>
          <span class="text-[10px] font-black text-indigo-500">${String(c.constructDateFix).slice(8, 10)}일</span>
        </div>
        <div class="text-[10px] text-slate-400 font-bold truncate">${esc(c.address)}</div>
      </div>
    `).join('') : '<div class="h-full flex flex-col items-center justify-center opacity-30 py-8"><i class="fas fa-calendar-xmark text-2xl mb-2"></i><span class="text-[10px] font-black">일정 없음</span></div>';
    });
}

/**
 * List Rendering
 */
function renderList() {
    let list = state.customers;
    const badge = $('activeFilterBadge');

    // 1. Dashboard Filter (Priority)
    if (state.activeListFilter) {
        const { key, type } = state.activeListFilter;

        if (type === 'perf') {
            if (key === 'done') {
                list = list.filter(isEsignDone).filter(isConstructionDone);
                badge.innerText = '필터: 공사완료';
            } else if (key === 'complete') {
                list = list.filter(isEsignDone).filter(isContractComplete);
                badge.innerText = '필터: 계약완료';
            } else if (key === 'progress') {
                list = list.filter(isEsignDone).filter(isContractInProgress);
                badge.innerText = '필터: 계약진행';
            } else if (key === 'cancel') {
                list = list.filter(isCancelled);
                badge.innerText = '필터: 계약취소';
            } else if (key === 'total') {
                // Total implies all (or all valid)
                badge.innerText = '필터: 전체';
            }
        } else if (type === 'task') {
            if (key === 'balance_missing') { list = list.filter(isCashBalanceMissing_Done); badge.innerText = '업무: 잔금 확인'; }
            else if (key === 'deposit_missing') { list = list.filter(isCashDepositMissing); badge.innerText = '업무: 입금 확인'; }
            else if (key === 'unordered') { list = list.filter(isUnordered); badge.innerText = '업무: 미발주'; }
            else if (key === 'construct_unconfirmed') { list = list.filter(isConstructionUnconfirmed); badge.innerText = '업무: 시공 미확정'; }
            else if (key === 'esign_pending') { list = list.filter(isEsignNotApproved); badge.innerText = '업무: 계약서 미승인'; }
            else if (key === 'hankae_wait') { list = list.filter(isHankaeWait); badge.innerText = '업무: 한캐승인대기'; }
            else if (key === 'installment_incomplete') { list = list.filter(isInstallmentIncomplete); badge.innerText = '업무: 할부계약 미완료'; }
        }

        // Ensure badge is visible or styled
        if (badge.innerText) badge.classList.remove('hidden');

    } else {
        // 2. Standard Filter (Date & Dropdowns)
        const mode = $('listMode').value;
        const year = $('listYear').value;
        const month = $('listMonth').value;
        const range = (mode === 'range') ? state.listRangeMonths : 0;

        list = filterByPeriod(state.customers, mode, year, month, range);

        // Hide badge if no special filter
        badge.innerText = '';
        badge.classList.add('hidden');
    }

    // Apply Common Dropdown Filters (always applicable? User request implies dash filter might be exclusive, but normally filters stack. 
    // However, the issue described "shows initially then reverts" suggests conflict. 
    // Let's allow dropdowns to REFINE dash results if helpful, or typically dash results standalone.
    // Given the request "click dash -> show list", usually we want JUST that subset.
    // But if user THEN changes a dropdown, should it refine? Yes. 
    // So we apply dropdown filters AFTER dashboard base filter.

    const filters = {
        branch: $('fBranch').value,
        inflowChannel: $('fChannel').value,
        payMethod: $('fPay').value,
        esignStatus: $('fEsign').value,
        subApprove: $('fSubApprove').value,
        hankaeFeedback: $('fHankae').value
    };

    if (filters.branch) list = list.filter(c => c.branch === filters.branch);
    if (filters.inflowChannel) list = list.filter(c => c.inflowChannel === filters.inflowChannel);
    if (filters.payMethod) list = list.filter(c => c.payMethod === filters.payMethod);
    if (filters.esignStatus) list = list.filter(c => c.esignStatus === filters.esignStatus);
    if (filters.subApprove) list = list.filter(c => c.subApprove === filters.subApprove);
    if (filters.hankaeFeedback) list = list.filter(c => c.hankaeFeedback === filters.hankaeFeedback);

    const q = String($('q').value || '').toLowerCase();
    if (q) {
        list = list.filter(c =>
            String(c.name || '').toLowerCase().includes(q) ||
            String(c.phone || '').includes(q) ||
            String(c.customerNo || '').toLowerCase().includes(q) ||
            String(c.address || '').toLowerCase().includes(q)
        );
    }

    // Sort by Registration Date (Latest First)
    list.sort((a, b) => {
        const da = new Date(a.regDate || 0);
        const db = new Date(b.regDate || 0);
        return db.getTime() - da.getTime();
    });

    $('cnt').innerText = list.length;

    const wrap = $('cards');
    wrap.className = `grid gap-6 ${state.listCardCols === '1' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`;

    wrap.innerHTML = list.length ? list.map(c => renderCard(c)).join('') : `
    <div class="col-span-full py-20 bg-white rounded-[32px] border border-slate-100 flex flex-col items-center justify-center opacity-40">
      <i class="fas fa-users-slash text-5xl mb-4"></i>
      <p class="font-black">검색 결과가 없습니다</p>
    </div>
  `;
}

function renderCard(c) {
    const isS = isSub(c);

    // Status Badge Logic
    const getBadge = (title, val, activeColor = 'bg-blue-50 text-blue-600') => {
        const isEmpty = !val || val === '해당없음' || val === '미선택' || val === '(미선택)' || val === '대기' || val === '미입금' || val === '미발주' || val === '(일시불)';
        const color = isEmpty ? 'bg-slate-50 text-slate-400 opacity-60' : activeColor;
        return `
            <div class="min-w-0 p-2 lg:p-3 rounded-2xl ${color} border border-transparent transition-all">
                <div class="text-[9px] font-black uppercase tracking-tighter mb-1 opacity-70">${title}</div>
                <div class="text-[11px] font-bold truncate">${val || '대기'}</div>
            </div>
        `;
    };

    const isCancelledConf = c.constructConfirm === '취소' || isCancelled(c);

    // 1. 시공확정
    let c1 = 'bg-indigo-50 text-indigo-600';
    if (c.constructConfirm === '취소') c1 = 'bg-rose-50 text-rose-600 ring-1 ring-rose-200';
    const b1 = getBadge('시공확정', c.constructConfirm || '대기', c1);

    // 2. PLUS가전
    const b2 = getBadge('PLUS가전', isCancelledConf ? '취소' : (c.plusYn || '해당없음'), 'bg-slate-100 text-slate-600');

    // 3. 전자서명
    const esignVal = isCancelledConf ? '계약취소' : (c.esignStatus || '미서명');
    const esignColor = esignVal === '서명완료' ? 'bg-emerald-50 text-emerald-600' : (esignVal.includes('취소') ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600');
    const b3 = getBadge('전자서명', esignVal, esignColor);

    // 4. 발주
    const orderVal = isCancelledConf ? '취소' : (c.kccDepositStatus === '입금완료' ? '발주완료' : '미발주');
    const b4 = getBadge('발주', orderVal, 'bg-orange-50 text-orange-600');

    // 5. 입금
    let depositVal = isCancelledConf ? '취소' : '미입금';
    let depositColor = 'bg-rose-50 text-rose-600';
    if (!isCancelledConf) {
        if (c.paidDate) { depositVal = '입금완료'; depositColor = 'bg-emerald-50 text-emerald-600'; }
        if (toNumber(c.balanceAmount) > 0 && !c.balancePaidDate) { depositVal = '잔금확인'; depositColor = 'bg-rose-50 text-rose-600'; }
    }
    const b5 = getBadge('입금', depositVal, depositColor);

    // 6. 구독승인
    const b6 = getBadge('구독승인', isCancelledConf ? '취소' : (isS ? (c.subApprove || '대기') : '(일시불)'), 'bg-slate-100 text-slate-600');

    // 7. 할부계약
    const b7 = getBadge('할부계약', isCancelledConf ? '취소' : (isS ? (c.installmentContractDate ? '계약완료' : '미완료') : '해당없음'), 'bg-slate-100 text-slate-600');

    // 8. 시공
    let constructVal = isCancelledConf ? '취소' : '대기';
    let constructColor = 'bg-slate-50 text-slate-400';
    if (!isCancelledConf) {
        if (isConstructionDone(c)) { constructVal = '시공완료'; constructColor = 'bg-blue-50 text-blue-600'; }
        else if (c.constructDateFix) { constructVal = '시공예정'; constructColor = 'bg-emerald-50 text-emerald-600'; }
    }
    const b8 = getBadge('시공', constructVal, constructColor);

    return `
    <div class="premium-card bg-white p-8 rounded-[40px] shadow-sm hover:shadow-xl hover:translate-y-[-2px] transition-all cursor-pointer animate-fade-in border border-slate-100" onclick="openModalByNo('${c.customerNo}')">
      <div class="flex items-start justify-between mb-2">
        <div class="flex items-center gap-4 flex-wrap">
          <h4 class="text-2xl font-black text-slate-900">${esc(c.name)}</h4>
          <span class="px-3 py-1 bg-slate-100 rounded-lg text-[11px] font-black text-slate-500 uppercase tracking-widest">고객번호 ${esc(String(c.customerNo).replace('C-', ''))}</span>
          <div class="flex items-center gap-4 text-sm font-bold text-slate-400">
            <span>${esc(c.phone)}</span>
            <span>${esc(formatDate(c.regDate))}</span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-black text-emerald-600">${fmtMoney(c.finalQuote)}</div>
        </div>
      </div>
      
      <div class="flex items-center gap-3 text-sm font-bold text-slate-600 mb-6 flex-wrap">
        <span class="text-slate-400 font-medium">${esc(c.address)}</span>
        <div class="h-3 w-[1px] bg-slate-200 mx-1"></div>
        <span class="px-2.5 py-1 bg-slate-50 rounded-lg text-slate-500">${esc(c.branch || '지점미정')}</span>
        <span class="px-2.5 py-1 bg-slate-50 rounded-lg text-slate-500">${esc(c.inflowChannel || '채널미정')}</span>
        <span class="px-2.5 py-1 ${isS ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'} rounded-lg">${esc(c.payMethod || '결제미정')}</span>
        ${c.constructDateFix ? `<span class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg flex items-center gap-1.5"><i class="far fa-calendar-check text-[10px]"></i> 시공일 ${formatDate(c.constructDateFix)}</span>` : ''}
      </div>
      
      <div class="grid grid-cols-4 md:grid-cols-4 xl:grid-cols-8 gap-2">
        ${b1}${b2}${b3}${b4}${b5}${b6}${b7}${b8}
      </div>
    </div>
  `;
}

function updateColBtn() {
    const b1 = $('btnCol1');
    const b2 = $('btnCol2');
    if (!b1 || !b2) return;

    const is1 = state.listCardCols === '1';

    // Set Active State for 1-Col Button
    b1.className = is1
        ? 'w-10 h-10 rounded-xl flex items-center justify-center transition-all bg-white text-indigo-600 shadow-sm'
        : 'w-10 h-10 rounded-xl flex items-center justify-center transition-all text-slate-400 hover:text-indigo-500';

    // Set Active State for 2-Col Button
    b2.className = !is1
        ? 'w-10 h-10 rounded-xl flex items-center justify-center transition-all bg-white text-indigo-600 shadow-sm'
        : 'w-10 h-10 rounded-xl flex items-center justify-center transition-all text-slate-400 hover:text-indigo-500';
}

/**
 * Modal Handling
 */
async function openModalByNo(no) {
    if (!no) {
        // Create Mode
        state.editing = {};
        state.isCreate = true;
        $('mTitle').innerText = '신규 고객 등록';
        $('mCustomerNo').innerText = '자동 생성';
        $('mHeaderPhone').innerText = '-';
        $('mHeaderAddress').innerText = '-';
    } else {
        // Edit Mode
        const c = state.customers.find(x => x.customerNo === no);
        if (!c) return alert('고객을 찾을 수 없습니다.');

        state.editing = { ...c };
        state.isCreate = false;
        $('mTitle').innerText = c.name || '고객 상세';
        $('mCustomerNo').innerText = c.customerNo;
        $('mHeaderPhone').innerText = c.phone || '-';
        $('mHeaderAddress').innerText = c.address || '-';
    }

    $('modal').classList.remove('hidden');
    $('modal').classList.add('flex');
    showModalLoading(true);

    // Delay for smooth UI
    setTimeout(() => {
        fillModalFields(state.editing);
        showModalLoading(false);
        switchModalTab('basic');
    }, 100);
}

async function saveCustomer() {
    if (!confirm('저장하시겠습니까?')) return;

    showModalLoading(true);
    try {
        const fields = ['customerNo', 'branch', 'regDate', 'applyDate', 'inflowChannel', 'name', 'phone', 'address', 'birth', 'memoQuick',
            'constructConfirm', 'constructDateFix', 'esignStatus', 'esignDate', 'payMethod', 'finalQuote', 'plusYn',
            'kccSupplyPrice', 'kccDepositStatus',
            'paidAmount', 'paidDate', 'balanceAmount', 'balancePaidDate',
            'interestYn', 'subTotalFee', 'subMonths', 'subMonthlyFee', 'subApprove',
            'hankaeFeedback', 'installmentContractDate', 'recordingRequestDate',
            'plusProduct', 'plusModel', 'deliveryDate', 'memo'];

        const payload = { ...state.editing };
        fields.forEach(f => {
            const el = $('f-' + f);
            if (el) payload[f] = el.value;
        });

        // Remove commas from money fields
        ['finalQuote', 'kccSupplyPrice', 'paidAmount', 'balanceAmount', 'subTotalFee', 'subMonthlyFee'].forEach(f => {
            if (payload[f]) payload[f] = String(payload[f]).replace(/,/g, '');
        });

        const action = state.isCreate ? 'createCustomer' : 'updateCustomer';
        const res = await serverCall(action, payload);

        if (res.ok) {
            alert('저장되었습니다.');
            $('modal').classList.add('hidden');
            reloadAll(false);
        } else {
            alert('오류: ' + res.msg);
        }
    } catch (e) {
        alert('저장 실패: ' + e.message);
    } finally {
        showModalLoading(false);
    }
}

function fillModalFields(c) {
    const fields = ['customerNo', 'branch', 'regDate', 'applyDate', 'inflowChannel', 'name', 'phone', 'address', 'birth', 'memoQuick',
        'constructConfirm', 'constructDateFix', 'esignStatus', 'esignDate', 'payMethod', 'finalQuote', 'plusYn',
        'kccSupplyPrice', 'kccDepositStatus',
        'paidAmount', 'paidDate', 'balanceAmount', 'balancePaidDate',
        'interestYn', 'subTotalFee', 'subMonths', 'subMonthlyFee', 'subApprove',
        'hankaeFeedback', 'installmentContractDate', 'recordingRequestDate',
        'plusProduct', 'plusModel', 'deliveryDate', 'memo'];

    fields.forEach(f => {
        const el = $('f-' + f);
        if (!el) return;
        let v = c[f] || '';
        if (['finalQuote', 'kccSupplyPrice', 'paidAmount', 'balanceAmount', 'subTotalFee', 'subMonthlyFee'].includes(f)) {
            v = fmtMoney(v);
        }
        el.value = v;
    });
    formatAllMoneyInputs();
}

function switchModalTab(tab) {
    document.querySelectorAll('.mtab').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('text-indigo-600', active);
        b.classList.toggle('border-b-4', active);
        b.classList.toggle('border-indigo-600', active);
        b.classList.toggle('text-slate-400', !active);
    });

    document.querySelectorAll('.msec').forEach(s => {
        s.classList.toggle('hidden', s.dataset.tab !== tab);
    });
}

function showModalLoading(on) {
    $('modalLoading').classList.toggle('hidden', !on);
    $('modalLoading').classList.add(on ? 'flex' : 'hidden');
}

/**
 * Event Listeners
 */
// Initialize App
function initApp() {
    console.log('Initializing App...');

    const form = $('loginForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('Form Submit Detected');
            login();
        });
    } else {
        console.error('Login Form Not Found');
    }

    const btnLogout = $('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', () => { localStorage.clear(); location.reload(); });

    document.querySelectorAll('.navBtn').forEach(b => {
        b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    const dashMode = $('dashMode');
    if (dashMode) dashMode.addEventListener('change', renderDashboardInteractive);

    const dashYear = $('dashYear');
    if (dashYear) dashYear.addEventListener('change', renderDashboardInteractive);

    const dashMonth = $('dashMonth');
    if (dashMonth) dashMonth.addEventListener('change', renderDashboardInteractive);

    document.querySelectorAll('.dashQuick').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const m = parseInt(e.target.dataset.m);
            state.dashRangeMonths = m;
            if (dashMode) dashMode.value = 'range';

            // Visual feedback for quick buttons
            document.querySelectorAll('.dashQuick').forEach(b => {
                b.classList.remove('bg-indigo-600', 'text-white', 'shadow-lg');
                b.classList.add('bg-transparent', 'text-slate-500');
            });
            e.target.classList.remove('bg-transparent', 'text-slate-500');
            e.target.classList.add('bg-indigo-600', 'text-white', 'shadow-lg');

            renderDashboardInteractive();
        });
    });

    const listMode = $('listMode');
    if (listMode) listMode.addEventListener('change', renderList);

    const q = $('q');
    if (q) q.addEventListener('input', renderList);

    // Bind Filters
    ['fBranch', 'fChannel', 'fPay', 'fEsign', 'fSubApprove', 'fHankae'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('change', renderList);
    });

    // Money Input live formatting
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('money-input')) {
            const pos = e.target.selectionStart;
            const oldLen = e.target.value.length;
            e.target.value = formatMoneyValue(e.target.value);
            const newLen = e.target.value.length;
            e.target.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen));
        }
    });

    // Phone Auto-hyphen
    const phoneInput = $('f-phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            const v = e.target.value.replace(/[^0-9]/g, '');
            if (v.length < 4) e.target.value = v;
            else if (v.length < 7) e.target.value = v.substr(0, 3) + '-' + v.substr(3);
            else if (v.length < 11) e.target.value = v.substr(0, 3) + '-' + v.substr(3, 3) + '-' + v.substr(6);
            else e.target.value = v.substr(0, 3) + '-' + v.substr(3, 4) + '-' + v.substr(7);
        });
    }

    // Address Search
    const btnAddr = $('btnAddr');
    if (btnAddr) {
        btnAddr.addEventListener('click', () => {
            new daum.Postcode({
                oncomplete: function (data) {
                    $('f-address').value = data.roadAddress || data.jibunAddress;
                }
            }).open();
        });
    }

    const calPrev = $('calPrev');
    if (calPrev) calPrev.addEventListener('click', () => {
        state.calDate.setMonth(state.calDate.getMonth() - 1);
        renderCalendar();
    });

    const calNext = $('calNext');
    if (calNext) calNext.addEventListener('click', () => {
        state.calDate.setMonth(state.calDate.getMonth() + 1);
        renderCalendar();
    });

    // Expose functions to window
    window.openModalByNo = openModalByNo;
    window.onDashPerfClick = onDashPerfClick;
    window.onDashTaskClick = onDashTaskClick;

    // Refresh Button Logic: Reset filters and reload
    const btnRefresh = $('btnRefresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            busy(true, '데이터 새로고침 중...');
            try {
                // Clear Dashboard Filter
                state.activeListFilter = null;

                // Reset Filters
                ['fBranch', 'fChannel', 'fPay', 'fEsign', 'fSubApprove', 'fHankae'].forEach(id => {
                    if ($(id)) $(id).value = '';
                });
                if ($('q')) $('q').value = '';
                if ($('listMode')) $('listMode').value = 'all'; // Show all customers

                // Reset Date Selectors to current
                const now = new Date();
                if ($('listYear')) $('listYear').value = String(now.getFullYear());
                if ($('listMonth')) $('listMonth').value = String(now.getMonth() + 1).padStart(2, '0');

                await reloadAll(false);
                console.log('Filters reset and data reloaded');
            } catch (e) {
                console.error(e);
                alert('새로고침 실패');
            } finally {
                busy(false);
            }
        });
    }

    const btnAdd = $('btnAdd');
    if (btnAdd) btnAdd.addEventListener('click', () => openModalByNo(''));

    const btnClose = $('btnClose');
    if (btnClose) btnClose.addEventListener('click', () => $('modal').classList.add('hidden'));

    const btnSave = $('btnSave');
    if (btnSave) btnSave.addEventListener('click', () => saveCustomer());

    // Column View Toggle
    // Column View Toggle
    const btnCol1 = $('btnCol1');
    const btnCol2 = $('btnCol2');

    if (btnCol1 && btnCol2) {
        btnCol1.addEventListener('click', () => {
            state.listCardCols = '1';
            localStorage.setItem('listCardCols', '1');
            renderList();
            updateColBtn();
        });

        btnCol2.addEventListener('click', () => {
            state.listCardCols = '2';
            localStorage.setItem('listCardCols', '2');
            renderList();
            updateColBtn();
        });
        updateColBtn();
    }

    document.querySelectorAll('.mtab').forEach(b => {
        b.addEventListener('click', () => switchModalTab(b.dataset.tab));
    });

    // Pre-fill GAS URL (Only if explicitly stored, otherwise use default)
    if ($('gasUrl')) {
        const storedUrl = localStorage.getItem('GAS_URL');
        $('gasUrl').value = (storedUrl && storedUrl.includes('script.google.com')) ? storedUrl : DEFAULT_GAS_URL;
    }

    // Check Session
    const ts = localStorage.getItem('kcc_auth_ts');
    if (ts && (Date.now() - ts < 3 * 60 * 60 * 1000)) {
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        state.isLoggedIn = true;
        reloadAll(true);
    }
}

// Run Initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

function onDashPerfClick(key, pay) {
    state.activeListFilter = { key, type: 'perf' };
    switchTab('list', false, true);
    renderList();
}

function onDashTaskClick(key) {
    state.activeListFilter = { key, type: 'task' };
    switchTab('list', false, true);
    renderList();
}

function renderBanners() {
    const wrap = $('banners');
    if (!wrap) return;
    const items = state.config.banners || [];
    if (!items.length) {
        wrap.innerHTML = '<div class="text-[10px] text-slate-600 italic py-2">등록된 배너가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = items.slice(0, 3).map(b => `
        <a href="${b.link || '#'}" target="_blank" class="block group relative overflow-hidden rounded-xl bg-slate-800 border border-white/5 transition-all hover:border-indigo-500/50">
            <div class="aspect-[16/9] w-full bg-slate-700 overflow-hidden">
                <img src="${b.img}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" alt="${esc(b.title)}">
            </div>
            <div class="p-2.5 bg-black/20 backdrop-blur-sm border-t border-white/5">
                <div class="text-[10px] font-bold text-slate-400 group-hover:text-white transition-all truncate">${esc(b.title)}</div>
            </div>
        </a>
    `).join('');
}

function renderCalendar() {
    const d = state.calDate;
    const year = d.getFullYear();
    const month = d.getMonth();

    $('calTitle').innerText = `${year}.${String(month + 1).padStart(2, '0')}`;

    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();
    const totalDays = last.getDate();

    const grid = $('calGrid');
    grid.innerHTML = '';

    // Days from prev month
    for (let i = 0; i < startDay; i++) {
        grid.innerHTML += `<div class="bg-white min-h-[120px] p-2 opacity-20"></div>`;
    }

    // Current month days
    for (let i = 1; i <= totalDays; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const customers = state.customers.filter(c => c.constructDateFix === dateStr);

        let html = `
            <div class="bg-white min-h-[120px] p-2 border-r border-b border-slate-50">
                <div class="text-[10px] font-bold text-slate-400 mb-2">${i}</div>
                <div class="space-y-1">
                    ${customers.slice(0, 3).map(c => `
                        <div class="text-[9px] p-1 bg-indigo-50 text-indigo-600 rounded truncate cursor-pointer hover:bg-indigo-100" onclick="openModalByNo('${c.customerNo}')">
                            ${esc(c.name)}
                        </div>
                    `).join('')}
                    ${customers.length > 3 ? `<div class="text-[8px] text-center text-slate-300">+${customers.length - 3}</div>` : ''}
                </div>
            </div>
        `;
        grid.innerHTML += html;
    }
}
