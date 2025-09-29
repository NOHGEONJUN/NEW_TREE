const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');

// 전역 설정 객체
const CONFIG = {
    BATCH_SIZE: 10,           // 배치 크기 (10개씩 처리)
    MAX_RETRIES: 3,           // 최대 재시도 횟수
    RETRY_DELAY: 2000,        // 재시도 간격 (2초)
    TIMEOUTS: {
        DEFAULT: 3000,        // 1초 → 3초 (서버 응답 지연 대응)
        LOADING: 5000,        // 1.5초 → 5초 (로딩 시간 증가)
        LONG: 8000,           // 3초 → 8초 (긴 작업 대응)
        SELECTOR: 10000,      // 5초 → 10초 (요소 찾기 시간 증가)
        LONG_SELECTOR: 15000, // 8초 → 15초 (복잡한 요소 찾기)
        VERY_LONG: 30000,     // 15초 → 30초 (매우 긴 작업)
        PAGE_LOAD: 60000      // 페이지 로딩 타임아웃 (60초)
    },
    SELECTORS: {
        BUTTONS: {
            LOGIN: 'a[href*="login"]',
            SEARCH: 'input[type="submit"]',
            NEXT: '#mf_wfm_potal_main_wfm_content_btn_next',
            CONFIRM: 'a:has-text("확인")',
            VIEW_ISSUE: 'a:has-text("열람/발급")'
        },
        INPUTS: {
            COMPANY_NAME: 'input[name="companyName"]',
            USERNAME: 'input[name="username"]',
            PASSWORD: 'input[name="password"]'
        },
        ELEMENTS: {
            SEARCH_RESULTS: '.search-results',
            COMPANY_LIST: '.company-list',
            NO_RESULTS: 'text="검색조건에 맞는 법인등기기록을 찾지 못했습니다."'
        }
    },
    DEFAULT_VALUES: {
        REGISTRY_OFFICE: '전체등기소',
        CORPORATION_TYPE: '전체 법인(지배인, 미성년자, 법정대리인 제외)',
        REGISTRY_STATUS: '살아있는등기',
        BRANCH_TYPE: '전체 본지점',
        WEEKEND_OPTION: 'N'
    }
};

class IROSFindAutomation {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.originalPage = null; // 원래 탭 참조 저장
        this.companies = [];
        this.processedCount = 0;  // 처리된 법인 수
        this.successCount = 0;    // 성공한 법인 수
        this.failCount = 0;       // 실패한 법인 수
        this.currentBatch = 0;    // 현재 배치 번호
    }

    // CSV 파일 읽기 및 파싱
    async parseCSVData(csvPath) {
        try {
            const csvContent = fs.readFileSync(csvPath, 'utf8');
            const lines = csvContent.split('\n').filter(line => line.trim());
            
            const companies = [];
            const headers = lines[0].split(',');
            
            // 헤더 검증 - 정확히 3개 컬럼만 허용
            const expectedHeaders = ['등기상호', '등기소', '법인구분'];
            if (headers.length !== 3) {
                console.log(`⚠️ CSV 헤더가 3개가 아닙니다. (현재: ${headers.length}개)`);
                console.log(`📋 예상 헤더: ${expectedHeaders.join(', ')}`);
                console.log(`📋 실제 헤더: ${headers.join(', ')}`);
            }
            
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                if (values[0] && values[0].trim()) { // 등기상호가 있는 경우만
                    companies.push({
                        등기상호: values[0].trim(),
                        등기소: values[1] && values[1].trim() ? values[1].trim() : '', // 빈칸이면 빈 문자열
                        법인구분: values[2] && values[2].trim() ? values[2].trim() : '' // 빈칸이면 빈 문자열
                    });
                }
            }
            
            return companies;
        } catch (error) {
            console.log(`❌ CSV 파일 읽기 오류: ${error.message}`);
            return [];
        }
    }

    // 사용자 입력 받기
    async getUserInput() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('🔍 찾을 법인 상호명을 입력하세요: ', (answer) => {
                rl.close();
                if (answer.trim()) {
                    resolve([{
                        등기상호: answer.trim(),
                        등기소: '', // 사용자 입력시에는 빈 문자열
                        법인구분: '' // 사용자 입력시에는 빈 문자열
                    }]);
                } else {
                    console.log('❌ 상호명이 입력되지 않았습니다.');
                    resolve([]);
                }
            });
        });
    }

    // 브라우저 시작
    async start() {
        console.log('🚀 IROS 법인등기 자동화 시작...');
        
        // 1단계: 브라우저 실행 (완전 최대화)
        this.browser = await chromium.launch({ 
            headless: false,
            channel: 'chrome',
            args: [
                '--start-maximized',
                '--no-first-run',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-infobars',
                '--window-size=1920,1080'
            ]
        });
        
        // context 생성 및 첫 번째 페이지 생성
        console.log('🔧 context 생성 중...');
        this.context = this.browser.newContext();
        console.log('✅ context 생성 완료');
        
        console.log('🔧 첫 번째 페이지 생성 중...');
        this.page = await this.browser.newPage();
        console.log('✅ 첫 번째 페이지 생성 완료');
        
        this.originalPage = this.page; // 원래 탭 참조 저장
        console.log('✅ originalPage 참조 저장 완료');
        console.log(`🔍 originalPage URL: ${this.originalPage.url()}`);
        
        // 브라우저 종료 감지 이벤트 리스너 추가
        this.browser.on('disconnected', () => {
            console.log('\n🔴 브라우저가 닫혔습니다. 프로그램을 종료합니다...');
            process.exit(0);
        });
        
        // 2단계: 뷰포트를 화면 크기에 맞게 설정
        const screenInfo = await this.page.evaluate(() => ({
            width: window.screen.width,
            height: window.screen.height
        }));
        
        await this.page.setViewportSize({ 
            width: screenInfo.width || 1920, 
            height: screenInfo.height || 1080 
        });
        
        console.log(`🖥️ 화면 크기로 설정: ${screenInfo.width}x${screenInfo.height}`);
        
        // 3단계: IROS 사이트 접속
        console.log('🌐 IROS 사이트 접속 중...');
        await this.page.goto('https://www.iros.go.kr/index.jsp', {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.TIMEOUTS.PAGE_LOAD
        });
        
        // 4단계: 페이지 완전 로딩 대기
        await this.page.waitForLoadState('domcontentloaded');
        await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
        
        // 5단계: 웹페이지 완전 로딩 확인
        console.log('🔍 웹페이지 완전 로딩 확인 중...');
        await this.waitForPageToBeReady();
        console.log('✅ 웹페이지 로딩 완료 확인');
        
        // 6단계: 팝업 및 배너 정교하게 제거 (중요한 메뉴 보호)
        console.log('🧹 팝업 및 배너 제거 시작...');
        const removedCount = await this.page.evaluate(() => {
            let removedCount = 0;
            
            // 1. 명확한 닫기 버튼들만 클릭 (중요한 메뉴 제외)
            const closeButtons = document.querySelectorAll('button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close, .close-btn, [alt*="닫기"], [alt*="close"]');
            closeButtons.forEach(btn => {
                // 중요한 메뉴나 네비게이션 요소는 제외
                const isImportantMenu = btn.closest('nav, .nav, .menu, .navigation, .gnb, .lnb, .sidebar');
                const hasImportantText = btn.textContent && (
                    btn.textContent.includes('관심등기') || 
                    btn.textContent.includes('나의 등기정보') ||
                    btn.textContent.includes('메뉴') ||
                    btn.textContent.includes('로그인') ||
                    btn.textContent.includes('검색')
                );
                
                if (btn.offsetParent !== null && !isImportantMenu && !hasImportantText) {
                    btn.click();
                    removedCount++;
                    console.log('닫기 버튼 클릭:', btn);
                }
            });
            
            // 2. "오늘 다시 보지 않기" 링크만 클릭
            const allLinks = document.querySelectorAll('a');
            allLinks.forEach(link => {
                if (link.textContent && link.textContent.includes('오늘 다시 보지 않기') && link.offsetParent !== null) {
                    link.click();
                    removedCount++;
                    console.log('오늘 다시 보지 않기 클릭:', link);
                }
            });
            
            // 3. 팝업 요소들만 정교하게 숨기기 (메인 콘텐츠 제외)
            const popupElements = document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"], [class*="modal"], [id*="modal"]');
            popupElements.forEach(el => {
                // 메인 콘텐츠나 중요한 페이지 요소는 제외
                const isMainContent = el.closest('#content, .content, .main, #main, .container, #container, .page, #page, nav, .nav, .menu, .navigation, .gnb, .lnb, .sidebar');
                const isImportantElement = el.textContent && (
                    el.textContent.includes('등기항목') || 
                    el.textContent.includes('법인등기') || 
                    el.textContent.includes('관심등기') ||
                    el.textContent.includes('나의 등기정보') ||
                    el.textContent.includes('메뉴') ||
                    el.textContent.includes('로그인') ||
                    el.textContent.includes('검색')
                );
                
                if (el.offsetParent !== null && !isMainContent && !isImportantElement) {
                    el.style.display = 'none';
                    removedCount++;
                    console.log('팝업 요소 숨김:', el);
                }
            });
            
            return removedCount;
        });
        
        console.log(`✅ ${removedCount}개의 팝업/배너가 제거되었습니다.`);
        
        // 6단계: 브라우저 창 최대화 강제 실행
        await this.page.evaluate(() => {
            if (window.screen && window.screen.width && window.screen.height) {
                window.resizeTo(window.screen.width, window.screen.height);
                window.moveTo(0, 0);
            }
        });
        
        console.log('✅ 브라우저 시작 완료');
    }


    // 로그인 대기
    async waitForLogin() {
        console.log('🔐 로그인을 완료해주세요...');
        console.log('💡 로그인이 완료되면 Enter를 눌러주세요.');
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('', async () => {
                rl.close();
                console.log('✅ 로그인 확인됨');
                
                // 로그인 후 홈페이지에서 팝업 및 배너 제거
                console.log('🧹 로그인 후 팝업 및 배너 제거 중...');
                await this.removePopupsAfterLogin();
                
                resolve();
            });
        });
    }

    // 로그인 후 팝업 및 배너 제거 (중요한 메뉴 보호)
    async removePopupsAfterLogin() {
        try {
            // 페이지 로딩 완료 대기
            await this.page.waitForLoadState('domcontentloaded');
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            
            const removedCount = await this.page.evaluate(() => {
                let removedCount = 0;
                
                // 1. 명확한 닫기 버튼들만 클릭 (중요한 메뉴 제외)
                const closeButtons = document.querySelectorAll('button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close, .close-btn, [alt*="닫기"], [alt*="close"]');
                closeButtons.forEach(btn => {
                    // 중요한 메뉴나 네비게이션 요소는 제외
                    const isImportantMenu = btn.closest('nav, .nav, .menu, .navigation, .gnb, .lnb, .sidebar');
                    const hasImportantText = btn.textContent && (
                        btn.textContent.includes('관심등기') || 
                        btn.textContent.includes('나의 등기정보') ||
                        btn.textContent.includes('메뉴') ||
                        btn.textContent.includes('로그인') ||
                        btn.textContent.includes('검색')
                    );
                    
                    if (btn.offsetParent !== null && !isImportantMenu && !hasImportantText) {
                        btn.click();
                        removedCount++;
                        console.log('로그인 후 닫기 버튼 클릭:', btn);
                    }
                });
                
                // 2. "오늘 다시 보지 않기" 링크만 클릭
                const allLinks = document.querySelectorAll('a');
                allLinks.forEach(link => {
                    if (link.textContent && link.textContent.includes('오늘 다시 보지 않기') && link.offsetParent !== null) {
                        link.click();
                        removedCount++;
                        console.log('로그인 후 오늘 다시 보지 않기 클릭:', link);
                    }
                });
                
                // 3. 팝업 요소들만 정교하게 숨기기 (메인 콘텐츠 제외)
                const popupElements = document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"], [class*="modal"], [id*="modal"]');
                popupElements.forEach(el => {
                    // 메인 콘텐츠나 중요한 페이지 요소는 제외
                    const isMainContent = el.closest('#content, .content, .main, #main, .container, #container, .page, #page, nav, .nav, .menu, .navigation, .gnb, .lnb, .sidebar');
                    const isImportantElement = el.textContent && (
                        el.textContent.includes('등기항목') || 
                        el.textContent.includes('법인등기') || 
                        el.textContent.includes('관심등기') ||
                        el.textContent.includes('나의 등기정보') ||
                        el.textContent.includes('메뉴') ||
                        el.textContent.includes('로그인') ||
                        el.textContent.includes('검색')
                    );
                    
                    if (el.offsetParent !== null && !isMainContent && !isImportantElement) {
                        el.style.display = 'none';
                        removedCount++;
                        console.log('로그인 후 팝업 요소 숨김:', el);
                    }
                });
                
                // 4. 배너 및 광고 요소들만 정교하게 숨기기 (메인 콘텐츠 제외)
                const bannerElements = document.querySelectorAll('[class*="banner"], [id*="banner"], [class*="ad"], [id*="ad"], [class*="notice"], [id*="notice"]');
                bannerElements.forEach(el => {
                    // 메인 콘텐츠나 중요한 페이지 요소는 제외
                    const isMainContent = el.closest('#content, .content, .main, #main, .container, #container, .page, #page, nav, .nav, .menu, .navigation, .gnb, .lnb, .sidebar');
                    const isImportantElement = el.textContent && (
                        el.textContent.includes('등기항목') || 
                        el.textContent.includes('법인등기') || 
                        el.textContent.includes('관심등기') ||
                        el.textContent.includes('나의 등기정보') ||
                        el.textContent.includes('메뉴') ||
                        el.textContent.includes('로그인') ||
                        el.textContent.includes('검색')
                    );
                    
                    if (el.offsetParent !== null && !isMainContent && !isImportantElement) {
                        el.style.display = 'none';
                        removedCount++;
                        console.log('로그인 후 배너 요소 숨김:', el);
                    }
                });
                
                return removedCount;
            });
            
            console.log(`✅ 로그인 후 ${removedCount}개의 팝업/배너가 제거되었습니다.`);
            
        } catch (error) {
            console.log('⚠️ 로그인 후 팝업 제거 중 오류:', error.message);
        }
    }

    // 관심등기 관리 페이지로 이동
    async navigateToInterestRegistry() {
        console.log('📋 관심등기 관리 페이지로 이동 중...');
        
        try {
            // 나의 등기정보 메뉴 클릭
            console.log('🔍 "나의 등기정보" 메뉴 클릭 중...');
            await this.page.getByRole('link', { name: '나의 등기정보' }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            console.log('✅ "나의 등기정보" 메뉴 클릭 완료');
            
            // 관심등기 관리 클릭
            console.log('🔍 "관심등기 관리" 메뉴 클릭 중...');
            await this.page.getByRole('link', { name: '관심등기 관리' }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
            console.log('✅ "관심등기 관리" 메뉴 클릭 완료');
            
            // 관심법인 탭 클릭
            console.log('🔍 "관심법인" 탭 클릭 중...');
            await this.page.getByRole('link', { name: '관심법인' }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            console.log('✅ "관심법인" 탭 클릭 완료');
            
            console.log('✅ 관심등기 관리 페이지 이동 완료');
            
        } catch (error) {
            console.log('❌ 관심등기 관리 페이지 이동 실패:', error.message);
            throw error;
        }
    }


    // 특정 법인 찾기 (등기상호 우선, 법인구분/관할등기소 선택적 확인)
    async findCompany(companyData) {
        console.log(`🔍 "${companyData.등기상호}" 법인을 찾는 중...`);
        
        try {
            let currentPage = 1;
            let isLastPage = false;
            
            while (!isLastPage) {
                console.log(`📄 ${currentPage}페이지에서 검색 중...`);
                
                // 현재 페이지에서 법인 검색
                const companyFound = await this.searchInCurrentPageWithDetails(companyData);
                if (companyFound) {
                    return true;
                }
                
                // 다음 페이지로 이동 시도
                const nextPageResult = await this.goToNextPage();
                if (nextPageResult.success) {
                    currentPage++;
                    console.log(`✅ ${currentPage}페이지로 이동했습니다.`);
                } else {
                    // 다음 페이지가 없거나 페이지가 변경되지 않음
                    isLastPage = true;
                    console.log(`📄 마지막 페이지(${currentPage}페이지)까지 확인했습니다.`);
                }
            }
            
            console.log(`❌ "${companyData.등기상호}" 법인을 1~${currentPage}페이지에서 찾을 수 없습니다.`);
            return false;
            
        } catch (error) {
            console.log(`❌ "${companyData.등기상호}" 법인 찾기 실패:`, error.message);
            return false;
        }
    }

    // 현재 페이지에서 법인 검색 (상세 정보 포함)
    async searchInCurrentPageWithDetails(companyData) {
        try {
            // 현재 페이지의 모든 상호명을 먼저 출력해서 디버깅
            const allCompanies = await this.page.evaluate(() => {
                const rows = document.querySelectorAll('tr');
                const companies = [];
                
                // 먼저 헤더에서 "상호" 컬럼의 인덱스 찾기
                let companyNameColumnIndex = -1;
                const headerRow = document.querySelector('tr');
                if (headerRow) {
                    const headerCells = headerRow.querySelectorAll('th, td');
                    for (let i = 0; i < headerCells.length; i++) {
                        const cell = headerCells[i];
                        const text = cell.textContent.trim();
                        const colIndex = cell.getAttribute('data-colindex');
                        
                        if (text === '상호' || colIndex === '2') {
                            companyNameColumnIndex = i;
                            console.log(`상호 컬럼 인덱스 발견: ${i} (텍스트: "${text}", data-colindex: "${colIndex}")`);
                            break;
                        }
                    }
                }
                
                // 상호 컬럼 인덱스를 찾지 못했으면 기본값 2 사용
                if (companyNameColumnIndex === -1) {
                    companyNameColumnIndex = 2;
                    console.log('상호 컬럼을 찾지 못해 기본값 2 사용');
                }
                
                for (let row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length > companyNameColumnIndex && cells[companyNameColumnIndex].textContent.trim()) {
                        const companyName = cells[companyNameColumnIndex].textContent.trim();
                        companies.push(companyName);
                        console.log(`법인명 읽음: "${companyName}" (컬럼 인덱스: ${companyNameColumnIndex})`);
                    }
                }
                return companies;
            });
            
            // 법인명 출력 제거 (디버깅용이었음)
            
            // JavaScript를 사용하여 법인명과 상세 정보 검색 (체크박스 클릭까지 포함)
            const found = await this.page.evaluate((data) => {
                const rows = document.querySelectorAll('tr');
                console.log(`🔍 검색 대상: "${data.등기상호}"`);
                console.log(`🔍 법인구분: "${data.법인구분 || '없음'}"`);
                console.log(`🔍 관할등기소: "${data.등기소 || '없음'}"`);
                
                // 먼저 헤더에서 "상호" 컬럼의 인덱스 찾기
                let companyNameColumnIndex = -1;
                const headerRow = document.querySelector('tr');
                if (headerRow) {
                    const headerCells = headerRow.querySelectorAll('th, td');
                    for (let i = 0; i < headerCells.length; i++) {
                        const cell = headerCells[i];
                        const text = cell.textContent.trim();
                        const colIndex = cell.getAttribute('data-colindex');
                        
                        if (text === '상호' || colIndex === '2') {
                            companyNameColumnIndex = i;
                            console.log(`상호 컬럼 인덱스 발견: ${i} (텍스트: "${text}", data-colindex: "${colIndex}")`);
                            break;
                        }
                    }
                }
                
                // 상호 컬럼 인덱스를 찾지 못했으면 기본값 2 사용
                if (companyNameColumnIndex === -1) {
                    companyNameColumnIndex = 2;
                    console.log('상호 컬럼을 찾지 못해 기본값 2 사용');
                }
                
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowText = row.textContent;
                    
                    // 1. 등기상호로 먼저 검색 (정확한 컬럼에서)
                    const cells = row.querySelectorAll('td');
                    if (cells.length > companyNameColumnIndex) {
                        const companyName = cells[companyNameColumnIndex].textContent.trim();
                        if (companyName.includes(data.등기상호)) {
                        console.log(`✅ 등기상호 "${data.등기상호}" 발견 (행 ${i})`);
                        console.log(`📋 행 내용: "${rowText}"`);
                        console.log(`🔍 검색 조건 - 등기상호: "${data.등기상호}", 법인구분: "${data.법인구분 || '없음'}", 관할등기소: "${data.등기소 || '없음'}"`);
                        
                            // 2. 관할등기소가 있으면 확인 (5번째 컬럼, 인덱스 4)
                            if (data.등기소 && data.등기소.trim()) {
                                const registryOffice = cells.length > 4 ? cells[4].textContent.trim() : '';
                                console.log(`🔍 관할등기소 확인 중: 예상 "${data.등기소}", 실제 "${registryOffice}"`);
                                if (!registryOffice.includes(data.등기소)) {
                                    console.log(`⚠️ 관할등기소 불일치: 예상 "${data.등기소}", 실제 "${registryOffice}"`);
                                    console.log(`⚠️ 관할등기소가 일치하지 않아 다음 행으로 넘어갑니다.`);
                                continue; // 다음 행으로
                            } else {
                                    console.log(`✅ 관할등기소 일치: "${data.등기소}"`);
                            }
                        } else {
                                console.log(`ℹ️ 관할등기소가 없어서 상호명만으로 검색`);
                            }
                        
                            // 3. 법인구분이 있으면 확인 (4번째 컬럼, 인덱스 3)
                        if (data.법인구분 && data.법인구분.trim()) {
                                const corporationType = cells.length > 3 ? cells[3].textContent.trim() : '';
                                console.log(`🔍 법인구분 확인 중: 예상 "${data.법인구분}", 실제 "${corporationType}"`);
                                if (!corporationType.includes(data.법인구분)) {
                                    console.log(`⚠️ 법인구분 불일치: 예상 "${data.법인구분}", 실제 "${corporationType}"`);
                                console.log(`⚠️ 법인구분이 일치하지 않아 다음 행으로 넘어갑니다.`);
                                continue; // 다음 행으로
                            } else {
                                console.log(`✅ 법인구분 일치: "${data.법인구분}"`);
                            }
                        } else {
                            console.log(`ℹ️ 법인구분이 없어서 건너뜀`);
                        }
                        
                            // 4. 모든 조건이 일치하면 체크박스 클릭 (1번째 컬럼, 인덱스 0)
                        console.log(`✅ 모든 조건이 일치합니다. 체크박스 찾는 중...`);
                            const checkbox = cells.length > 0 ? cells[0].querySelector('input[type="checkbox"]') : null;
                        if (checkbox) {
                            console.log(`✅ 체크박스 발견, 클릭 시도...`);
                            checkbox.click();
                                
                                // 체크박스가 실제로 체크되었는지 확인
                                const isChecked = checkbox.checked;
                                console.log(`🔍 체크박스 클릭 후 상태: ${isChecked ? '체크됨' : '체크 안됨'}`);
                                
                                if (isChecked) {
                            console.log(`✅ 체크박스 클릭 완료: "${data.등기상호}"`);
                            return true;
                                } else {
                                    console.log(`❌ 체크박스 클릭 실패: "${data.등기상호}"`);
                                    return false;
                                }
                        } else {
                            console.log(`❌ 체크박스를 찾을 수 없음 (행 ${i})`);
                            }
                        }
                    }
                }
                console.log(`❌ "${data.등기상호}" 법인을 찾을 수 없음`);
                return false;
            }, companyData);
            
            if (found) {
                console.log(`✅ "${companyData.등기상호}" 법인을 현재 페이지에서 찾았습니다.`);
                return true;
            } else {
                console.log(`❌ "${companyData.등기상호}" 법인을 현재 페이지에서 찾을 수 없습니다.`);
            }
            
            return false;
        } catch (error) {
            console.log(`❌ 현재 페이지에서 "${companyData.등기상호}" 검색 실패:`, error.message);
            return false;
        }
    }

    // 다음 페이지로 이동 (페이지 변경 확인 포함)
    async goToNextPage() {
        try {
            // 현재 페이지의 첫 번째 법인명을 저장 (페이지 변경 확인용)
            const currentFirstCompany = await this.page.evaluate(() => {
                const rows = document.querySelectorAll('tr');
                for (let row of rows) {
                    const cells = row.querySelectorAll('td');
                    // 상호명은 3번째 컬럼 (인덱스 2)에 있음
                    if (cells.length > 2 && cells[2].textContent.trim()) {
                        return cells[2].textContent.trim();
                    }
                }
                return null;
            });
            
            console.log(`🔍 현재 페이지 첫 번째 법인: "${currentFirstCompany}"`);
            
            // 현재 페이지 번호 확인
            const currentPageNumber = await this.page.evaluate(() => {
                // 활성화된 페이지 번호 찾기
                const activePage = document.querySelector('.w2pageList_control_pageNum.w2pageList_col_pageNum.w2pageList_control_pageNum_active');
                if (activePage) {
                    return parseInt(activePage.textContent.trim());
                }
                return 1;
            });
            
            const nextPageNumber = currentPageNumber + 1;
            console.log(`🔍 현재 페이지: ${currentPageNumber}, 다음 페이지: ${nextPageNumber}`);
            
            // 다음 페이지 버튼 찾기 (여러 방법 시도)
            let nextButton = null;
            
            // 방법 1: 숫자로 직접 찾기
            nextButton = this.page.locator(`button:has-text("${nextPageNumber}")`).first();
            if (!(await nextButton.isVisible())) {
                // 방법 2: 링크로 찾기
                nextButton = this.page.locator(`a:has-text("${nextPageNumber}")`).first();
            }
            if (!(await nextButton.isVisible())) {
                // 방법 3: "다음 페이지" 버튼 찾기
                nextButton = this.page.getByRole('link', { name: '다음 페이지' });
            }
            
            if (await nextButton.isVisible()) {
                console.log(`📄 ${nextPageNumber}페이지 버튼을 클릭합니다...`);
                await nextButton.click();
                await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
                
                // 페이지가 실제로 변경되었는지 확인
                const newFirstCompany = await this.page.evaluate(() => {
                    const rows = document.querySelectorAll('tr');
                    for (let row of rows) {
                        const cells = row.querySelectorAll('td');
                        // 상호명은 3번째 컬럼 (인덱스 2)에 있음
                        if (cells.length > 2 && cells[2].textContent.trim()) {
                            return cells[2].textContent.trim();
                        }
                    }
                    return null;
                });
                
                console.log(`🔍 새 페이지 첫 번째 법인: "${newFirstCompany}"`);
                
                // 페이지가 변경되었는지 확인
                if (newFirstCompany && newFirstCompany !== currentFirstCompany) {
                    console.log(`✅ ${nextPageNumber}페이지로 이동했습니다. (첫 번째 법인: ${newFirstCompany})`);
                    return { success: true, pageNumber: nextPageNumber };
                } else {
                    console.log(`⚠️ 페이지 버튼을 클릭했지만 페이지가 변경되지 않았습니다. (마지막 페이지)`);
                    return { success: false, isLastPage: true };
                }
            } else {
                console.log(`📄 ${nextPageNumber}페이지 버튼이 없습니다. (마지막 페이지)`);
                return { success: false, isLastPage: true };
            }
        } catch (error) {
            console.log('❌ 다음 페이지 이동 실패:', error.message);
            return { success: false, error: error.message };
        }
    }

    // 법인 체크박스 클릭 (상세 정보 포함)
    async selectCompany(companyData) {
        console.log(`☑️ "${companyData.등기상호}" 법인을 선택합니다...`);
        
        try {
            // 🔍 디버깅: 선택 전 현재 상태 확인
            console.log(`🔍 선택 전 현재 페이지 URL: ${this.page.url()}`);
            console.log(`🔍 선택 전 현재 페이지 제목: ${await this.page.title()}`);
            
            // 🔍 디버깅: 페이지의 모든 체크박스 확인
            const allCheckboxes = await this.page.locator('input[type="checkbox"]').all();
            console.log(`🔍 페이지의 모든 체크박스 수: ${allCheckboxes.length}`);
            
            for (let i = 0; i < allCheckboxes.length; i++) {
                const checkbox = allCheckboxes[i];
                const isVisible = await checkbox.isVisible();
                const isChecked = await checkbox.isChecked();
                console.log(`  체크박스 ${i + 1}: 보임: ${isVisible}, 체크됨: ${isChecked}`);
            }
            
            // JavaScript를 사용하여 체크박스 클릭
            const clicked = await this.page.evaluate((data) => {
                const rows = document.querySelectorAll('tr');
                console.log(`🔍 총 행 수: ${rows.length}`);
                
                // 먼저 헤더에서 "상호" 컬럼의 인덱스 찾기
                let companyNameColumnIndex = -1;
                const headerRow = document.querySelector('tr');
                if (headerRow) {
                    const headerCells = headerRow.querySelectorAll('th, td');
                    for (let i = 0; i < headerCells.length; i++) {
                        const cell = headerCells[i];
                        const text = cell.textContent.trim();
                        const colIndex = cell.getAttribute('data-colindex');
                        
                        if (text === '상호' || colIndex === '2') {
                            companyNameColumnIndex = i;
                            console.log(`상호 컬럼 인덱스 발견: ${i} (텍스트: "${text}", data-colindex: "${colIndex}")`);
                            break;
                        }
                    }
                }
                
                // 상호 컬럼 인덱스를 찾지 못했으면 기본값 2 사용
                if (companyNameColumnIndex === -1) {
                    companyNameColumnIndex = 2;
                    console.log('상호 컬럼을 찾지 못해 기본값 2 사용');
                }
                
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowText = row.textContent;
                    
                    // 1. 등기상호로 먼저 검색 (정확한 컬럼에서)
                    const cells = row.querySelectorAll('td');
                    if (cells.length > companyNameColumnIndex) {
                        const companyName = cells[companyNameColumnIndex].textContent.trim();
                        if (companyName.includes(data.등기상호)) {
                        console.log(`✅ 등기상호 "${data.등기상호}" 발견 (행 ${i})`);
                        console.log(`📋 행 내용: "${rowText}"`);
                        console.log(`🔍 검색 조건 - 등기상호: "${data.등기상호}", 법인구분: "${data.법인구분 || '없음'}", 관할등기소: "${data.등기소 || '없음'}"`);
                        
                            // 2. 관할등기소가 있으면 확인 (5번째 컬럼, 인덱스 4)
                            if (data.등기소 && data.등기소.trim()) {
                                const registryOffice = cells.length > 4 ? cells[4].textContent.trim() : '';
                                console.log(`🔍 관할등기소 확인 중: 예상 "${data.등기소}", 실제 "${registryOffice}"`);
                                if (!registryOffice.includes(data.등기소)) {
                                    console.log(`⚠️ 관할등기소 불일치: 예상 "${data.등기소}", 실제 "${registryOffice}"`);
                                    console.log(`⚠️ 관할등기소가 일치하지 않아 다음 행으로 넘어갑니다.`);
                                continue; // 다음 행으로
                            } else {
                                    console.log(`✅ 관할등기소 일치: "${data.등기소}"`);
                            }
                        } else {
                                console.log(`ℹ️ 관할등기소가 없어서 상호명만으로 검색`);
                            }
                        
                            // 3. 법인구분이 있으면 확인 (4번째 컬럼, 인덱스 3)
                        if (data.법인구분 && data.법인구분.trim()) {
                                const corporationType = cells.length > 3 ? cells[3].textContent.trim() : '';
                                console.log(`🔍 법인구분 확인 중: 예상 "${data.법인구분}", 실제 "${corporationType}"`);
                                if (!corporationType.includes(data.법인구분)) {
                                    console.log(`⚠️ 법인구분 불일치: 예상 "${data.법인구분}", 실제 "${corporationType}"`);
                                console.log(`⚠️ 법인구분이 일치하지 않아 다음 행으로 넘어갑니다.`);
                                continue; // 다음 행으로
                            } else {
                                console.log(`✅ 법인구분 일치: "${data.법인구분}"`);
                            }
                        } else {
                            console.log(`ℹ️ 법인구분이 없어서 건너뜀`);
                        }
                        
                            // 4. 모든 조건이 일치하면 체크박스 클릭 (1번째 컬럼, 인덱스 0)
                        console.log(`✅ 모든 조건이 일치합니다. 체크박스 찾는 중...`);
                            const checkbox = cells.length > 0 ? cells[0].querySelector('input[type="checkbox"]') : null;
                        if (checkbox) {
                            console.log(`✅ 체크박스 발견, 클릭 시도...`);
                            checkbox.click();
                                
                                // 체크박스가 실제로 체크되었는지 확인
                                const isChecked = checkbox.checked;
                                console.log(`🔍 체크박스 클릭 후 상태: ${isChecked ? '체크됨' : '체크 안됨'}`);
                                
                                if (isChecked) {
                            console.log(`✅ 체크박스 클릭 완료: "${data.등기상호}"`);
                            return true;
                                } else {
                                    console.log(`❌ 체크박스 클릭 실패: "${data.등기상호}"`);
                                    return false;
                                }
                        } else {
                            console.log(`❌ 체크박스를 찾을 수 없음 (행 ${i})`);
                            }
                        }
                    }
                }
                console.log(`❌ "${data.등기상호}" 법인을 찾을 수 없음`);
                return false;
            }, companyData);
            
            if (clicked) {
                console.log(`✅ "${companyData.등기상호}" 법인 선택 완료`);
                
                // 🔍 디버깅: 선택 후 상태 확인
                await this.waitWithTimeout(500);
                console.log(`🔍 선택 후 현재 페이지 URL: ${this.page.url()}`);
                console.log(`🔍 선택 후 현재 페이지 제목: ${await this.page.title()}`);
                
                // 🔍 디버깅: 선택 후 체크박스 상태 확인
                const checkedBoxes = await this.page.locator('input[type="checkbox"]:checked').all();
                console.log(`🔍 선택 후 체크된 체크박스 수: ${checkedBoxes.length}`);
                
                // 🔍 실제로 체크박스가 체크되었는지 확인
                if (checkedBoxes.length === 0) {
                    console.log(`❌ 체크박스가 실제로 체크되지 않았습니다. "${companyData.등기상호}" 법인을 찾을 수 없습니다.`);
                    
                    // 🔍 디버깅: 실패 시 페이지 내용 확인
                    const pageContent = await this.page.evaluate(() => {
                        const rows = document.querySelectorAll('tr');
                        const content = [];
                        for (let i = 0; i < Math.min(rows.length, 5); i++) {
                            content.push(`행 ${i + 1}: ${rows[i].textContent.substring(0, 100)}...`);
                        }
                        return content;
                    });
                    console.log('🔍 페이지 내용 (처음 5행):', pageContent);
                    
                    return false;
                }
                
                return true;
            } else {
                console.log(`❌ "${companyData.등기상호}" 법인 체크박스를 찾을 수 없습니다.`);
                
                // 🔍 디버깅: 실패 시 페이지 내용 확인
                const pageContent = await this.page.evaluate(() => {
                    const rows = document.querySelectorAll('tr');
                    const content = [];
                    for (let i = 0; i < Math.min(rows.length, 5); i++) {
                        content.push(`행 ${i + 1}: ${rows[i].textContent.substring(0, 100)}...`);
                    }
                    return content;
                });
                console.log('🔍 페이지 내용 (처음 5행):', pageContent);
                
                return false;
            }
        } catch (error) {
            console.log(`❌ "${companyData.등기상호}" 법인 선택 실패:`, error.message);
            console.log('🔍 오류 상세 정보:', error);
            return false;
        }
    }

    // 열람/발급 버튼 클릭
    async clickViewIssueButton() {
        console.log('📄 열람/발급 버튼을 클릭합니다...');
        
        try {
            // 🔍 디버깅: 클릭 전 현재 상태 확인
            console.log(`🔍 클릭 전 현재 페이지 URL: ${this.page.url()}`);
            console.log(`🔍 클릭 전 현재 페이지 제목: ${await this.page.title()}`);
            
            // 🔍 디버깅: 열람/발급 버튼 요소 확인
            const viewButton = this.page.getByRole('link', { name: '열람/발급', exact: true });
            const isVisible = await viewButton.isVisible();
            const isEnabled = await viewButton.isEnabled();
            console.log(`🔍 열람/발급 버튼 상태 - 보임: ${isVisible}, 활성화: ${isEnabled}`);
            
            if (!isVisible) {
                console.log('❌ 열람/발급 버튼이 보이지 않습니다. 다른 방법으로 찾아보겠습니다...');
                
                // 🔍 디버깅: 다른 방법으로 열람/발급 버튼 찾기
                const allLinks = await this.page.locator('a').all();
                console.log(`🔍 페이지의 모든 링크 수: ${allLinks.length}`);
                
                for (let i = 0; i < allLinks.length; i++) {
                    const link = allLinks[i];
                    const text = await link.textContent();
                    const isVisible = await link.isVisible();
                    console.log(`  링크 ${i + 1}: "${text}" (보임: ${isVisible})`);
                    
                    if (text && (text.includes('열람') || text.includes('발급')) && isVisible) {
                        console.log(`✅ 열람/발급 버튼을 다른 방법으로 찾았습니다: "${text}"`);
                        await link.click();
                        console.log('✅ 대체 방법으로 열람/발급 버튼 클릭 완료');
                        
                        // 클릭 후 상태 확인
                        await this.waitWithTimeout(500);
                        
                        return true;
                    }
                }
                
                console.log('❌ 열람/발급 버튼을 찾을 수 없습니다.');
                return false;
            }
            
            // 🔍 디버깅: 포커스 설정 시도
            console.log('🎯 열람/발급 버튼에 포커스 설정 시도...');
            await viewButton.focus();
            console.log('✅ 포커스 설정 완료');
            
            // 🔍 디버깅: 클릭 전 잠시 대기
            await this.waitWithTimeout(500);
            console.log('⏳ 클릭 전 0.5초 대기 완료');
            
            // 열람/발급 버튼 클릭
            console.log('🖱️ 열람/발급 버튼 클릭 실행...');
            await viewButton.click();
            console.log('✅ 열람/발급 버튼 클릭 완료');
            
            // 클릭 후 상태 확인
            await this.waitWithTimeout(500);
            
            // 🔍 디버깅: 클릭 후 탭 상태 확인
            const context = this.page.context();
            const currentPages = context.pages();
            console.log(`📊 클릭 후 탭 수: ${currentPages.length}개`);
            currentPages.forEach((page, index) => {
                console.log(`  탭 ${index + 1}: ${page.url()}`);
            });
            
            return true;
        } catch (error) {
            console.log('❌ 열람/발급 버튼 클릭 실패:', error.message);
            console.log('🔍 오류 상세 정보:', error);
            
            // 🔍 디버깅: 오류 발생 시 현재 상태 확인
            try {
                console.log(`🔍 오류 발생 시 현재 페이지 URL: ${this.page.url()}`);
                console.log(`🔍 오류 발생 시 현재 페이지 제목: ${await this.page.title()}`);
                
                const context = this.page.context();
                const currentPages = context.pages();
                console.log(`📊 오류 발생 시 탭 수: ${currentPages.length}개`);
                currentPages.forEach((page, index) => {
                    console.log(`  탭 ${index + 1}: ${page.url()}`);
                });
            } catch (debugError) {
                console.log('🔍 디버깅 정보 수집 실패:', debugError.message);
            }
            
            return false;
        }
    }

    // 세부사항 선택 팝업에서 확인 버튼 클릭
    async confirmDetailsPopup() {
        console.log('✅ 세부사항 선택 팝업에서 확인 버튼을 클릭합니다...');
        
        try {
            // 🔍 디버깅: 클릭 전 현재 상태 확인
            console.log(`🔍 클릭 전 현재 페이지 URL: ${this.page.url()}`);
            console.log(`🔍 클릭 전 현재 페이지 제목: ${await this.page.title()}`);
            
            // 🔍 디버깅: 확인 버튼 요소 확인
            const confirmButton = this.page.getByRole('link', { name: '확인', exact: true });
            const isVisible = await confirmButton.isVisible();
            const isEnabled = await confirmButton.isEnabled();
            console.log(`🔍 확인 버튼 상태 - 보임: ${isVisible}, 활성화: ${isEnabled}`);
            
            if (!isVisible) {
                console.log('❌ 확인 버튼이 보이지 않습니다. 다른 방법으로 찾아보겠습니다...');
                
                // 🔍 디버깅: 다른 방법으로 확인 버튼 찾기
                const allLinks = await this.page.locator('a').all();
                console.log(`🔍 페이지의 모든 링크 수: ${allLinks.length}`);
                
                for (let i = 0; i < allLinks.length; i++) {
                    const link = allLinks[i];
                    const text = await link.textContent();
                    const isVisible = await link.isVisible();
                    console.log(`  링크 ${i + 1}: "${text}" (보임: ${isVisible})`);
                    
                    if (text && text.includes('확인') && isVisible) {
                        console.log(`✅ 확인 버튼을 다른 방법으로 찾았습니다: "${text}"`);
                        await link.click();
                        console.log('✅ 대체 방법으로 확인 버튼 클릭 완료');
                        
                        // 클릭 후 상태 확인
                        await this.waitWithTimeout(500);
                        
                        return true;
                    }
                }
                
                console.log('❌ 확인 버튼을 찾을 수 없습니다.');
                return false;
            }
            
            // 🔍 디버깅: 포커스 설정 시도
            console.log('🎯 확인 버튼에 포커스 설정 시도...');
            await confirmButton.focus();
            console.log('✅ 포커스 설정 완료');
            
            // 🔍 디버깅: 클릭 전 잠시 대기
            await this.waitWithTimeout(500);
            console.log('⏳ 클릭 전 0.5초 대기 완료');
            
            // 확인 버튼 클릭
            console.log('🖱️ 확인 버튼 클릭 실행...');
            await confirmButton.click();
            console.log('✅ 확인 버튼 클릭 완료');
            
            // 클릭 후 상태 확인
            await this.waitWithTimeout(1000);
            console.log(`🔍 클릭 후 현재 페이지 제목: ${await this.page.title()}`);
            
            // 🔍 디버깅: 클릭 후 탭 상태 확인
            const context = this.page.context();
            const currentPages = context.pages();
            console.log(`📊 클릭 후 탭 수: ${currentPages.length}개`);
            currentPages.forEach((page, index) => {
                console.log(`  탭 ${index + 1}: ${page.url()}`);
            });
            
            // 🔍 디버깅: 추가 대기 후 다시 확인
            console.log('⏳ 추가 2초 대기 후 탭 상태 재확인...');
            await this.waitWithTimeout(2000);
            const finalPages = context.pages();
            console.log(`📊 최종 탭 수: ${finalPages.length}개`);
            finalPages.forEach((page, index) => {
                console.log(`  탭 ${index + 1}: ${page.url()}`);
            });
            
            return true;
        } catch (error) {
            console.log('❌ 확인 버튼 클릭 실패:', error.message);
            console.log('🔍 오류 상세 정보:', error);
            
            // 🔍 디버깅: 오류 발생 시 현재 상태 확인
            try {
                console.log(`🔍 오류 발생 시 현재 페이지 URL: ${this.page.url()}`);
                console.log(`🔍 오류 발생 시 현재 페이지 제목: ${await this.page.title()}`);
                
                const context = this.page.context();
                const currentPages = context.pages();
                console.log(`📊 오류 발생 시 탭 수: ${currentPages.length}개`);
                currentPages.forEach((page, index) => {
                    console.log(`  탭 ${index + 1}: ${page.url()}`);
                });
            } catch (debugError) {
                console.log('🔍 디버깅 정보 수집 실패:', debugError.message);
            }
            
            return false;
        }
    }

    // 새 탭 처리 (로딩창 감지 및 완료 확인)
    async waitForNewTabAndReturn(shouldCloseTab = true) {
        try {
            console.log('🔄 새 탭 처리 시작...');
            
            // 🔍 디버깅: 현재 탭 상태 확인
            const context = this.page.context();
            const currentPages = context.pages();
            console.log(`📊 현재 탭 수: ${currentPages.length}개`);
            currentPages.forEach((page, index) => {
                console.log(`  탭 ${index + 1}: ${page.url()}`);
            });
            
            // 🔍 디버깅: 현재 페이지 URL 확인
            console.log(`🔍 현재 페이지 URL: ${this.page.url()}`);
            console.log(`🔍 현재 페이지 제목: ${await this.page.title()}`);
            
            // ✨ 새 탭이 열릴 것을 미리 감지하고 기다립니다.
            console.log('⏳ 새 탭 열림 이벤트 대기 시작...');
            const pagePromise = context.waitForEvent('page', { timeout: 10000 }); // 10초로 단축
            console.log('⏳ waitForEvent 설정 완료, 새 탭 열림 대기 중...');
            
            // ✨ 약속했던(Promise) 새 탭이 열리면 newPage 변수에 할당합니다.
            let newPage;
            try {
                newPage = await pagePromise;
            } catch (timeoutError) {
                console.log('⚠️ 새 탭이 10초 내에 열리지 않았습니다. 다른 방법을 시도합니다...');
                
                // 🔍 디버깅: 현재 탭 상태 재확인
                const currentPages = context.pages();
                console.log(`📊 타임아웃 시 탭 수: ${currentPages.length}개`);
                currentPages.forEach((page, index) => {
                    console.log(`  탭 ${index + 1}: ${page.url()}`);
                });
                
                // 새 탭이 이미 열려있는지 확인
                if (currentPages.length > 1) {
                    newPage = currentPages[currentPages.length - 1];
                    console.log(`✅ 새 탭 감지 완료: ${newPage.url()}`);
                    console.log(`📄 새 탭 제목: ${await newPage.title()}`);
                } else {
                    console.log('❌ 새 탭이 열리지 않았습니다. 현재 페이지에서 처리합니다.');
                    // 새 탭이 열리지 않았을 때 이전 페이지로 돌아가기
                    console.log('🔙 새 탭이 열리지 않아 이전 페이지로 돌아갑니다...');
                    await this.goToPreviousPage();
                    return; // 새 탭이 없으면 그냥 종료
                }
            }
            
            // 🔍 디버깅: 새 탭 추가 후 탭 상태 확인
            const updatedPages = context.pages();
            console.log(`📊 새 탭 추가 후 탭 수: ${updatedPages.length}개`);
            updatedPages.forEach((page, index) => {
                console.log(`  탭 ${index + 1}: ${page.url()}`);
            });
            
            // ✨ 새 탭의 로딩이 완료될 때까지 기다립니다.
            console.log('⏳ 새 탭 DOM 로딩 대기 중...');
            await newPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
            console.log('✅ 새 탭 DOM 로딩 완료.');
            
            // 로딩창이 사라질 때까지 대기
            console.log('⏳ 새 탭에서 로딩창이 사라질 때까지 대기 중...');
            await this.waitForLoadingToComplete(newPage);
            console.log('✅ 새 탭에서 로딩창 대기 완료');
            
            if (shouldCloseTab) {
                // 새 탭 닫기
                console.log('❌ 새 탭 닫기 중...');
                try {
                    await newPage.close();
                    console.log('✅ 새 탭 닫기 완료');
                } catch (closeError) {
                    console.log('⚠️ 새 탭 닫기 중 오류:', closeError.message);
                    // 강제로 탭 닫기 시도
                    try {
                        await newPage.evaluate(() => window.close());
                    } catch (forceCloseError) {
                        console.log('⚠️ 강제 탭 닫기도 실패:', forceCloseError.message);
                    }
                }
                
                // 원래 탭으로 포커스 이동
                console.log('🔙 원래 탭으로 포커스 이동 중...');
                try {
                    await this.page.bringToFront();
                    console.log('✅ 원래 탭 포커스 완료');
                } catch (focusError) {
                    console.log('⚠️ 포커스 이동 중 오류:', focusError.message);
                }
            
            // 이전에 선택했던 체크박스 해제
            console.log('☑️ 이전에 선택했던 체크박스 해제 중...');
            await this.uncheckPreviousSelection();
            } else {
                // 마지막 법인: 새 탭 유지하고 원래 탭으로 포커스만 이동
                console.log('🔙 원래 탭으로 포커스 이동 중... (새 탭 유지)');
                await this.page.bringToFront();
                console.log('✅ 원래 탭 포커스 완료 (새 탭 유지)');
            }
            
            console.log('✅ 새 탭 처리 완료');
            
        } catch (error) {
            console.log('❌ 새 탭 처리 중 오류:', error.message);
            console.log('🔍 오류 상세 정보:', error);
            
            // 🔍 디버깅: 오류 발생 시 현재 상태 확인
            try {
                const context = this.page.context();
                const currentPages = context.pages();
                console.log(`📊 오류 발생 시 탭 수: ${currentPages.length}개`);
                currentPages.forEach((page, index) => {
                    console.log(`  탭 ${index + 1}: ${page.url()}`);
                });
            } catch (debugError) {
                console.log('🔍 디버깅 정보 수집 실패:', debugError.message);
            }
        }
    }





    // 개선된 로딩창 감지 및 대기 (화면 중앙 오버레이 기반)
    async waitForLoadingToComplete(targetPage = null) {
        const page = targetPage || this.page;
        
        try {
            console.log('⏳ 로딩창 감지 시작...');
            
            // 1. 페이지 로딩 완료 대기
            await page.waitForLoadState('domcontentloaded');
            console.log('✅ 페이지 DOM 로딩 완료');
            
            // 2. 로딩창이 나타날 때까지 대기
            console.log('⏳ 로딩창이 나타날 때까지 대기 중...');
            let loadingAppeared = false;
            let attempts = 0;
            const maxAttempts = 10; // 5초 동안 대기 (500ms * 10)
            
            while (!loadingAppeared && attempts < maxAttempts) {
                const hasLoading = await page.evaluate(() => {
                    const checks = [
                        // 1. 텍스트 기반 감지 (정확한 로딩 메시지만)
                        () => {
                            const loadingTexts = ['처리 중입니다.', '로딩 중...', 'Loading...', '잠시만 기다려 주세요'];
                            const allElements = document.getElementsByTagName('*');
                            for (let el of allElements) {
                                if (el.textContent) {
                                    const text = el.textContent.trim();
                                    if (loadingTexts.some(loadingText => text === loadingText)) {
                                        return el.offsetParent !== null;
                                    }
                                }
                            }
                            return false;
                        },
                        
                        // 2. 정확한 로딩 선택자만 감지 (데이터 그리드 제외)
                        () => {
                            const loadingSelectors = [
                                '#processMsgLayer',
                                '#__processbarIFrame', 
                                '.loading-spinner',
                                '[class*="loading"]:not([class*="grid"]):not([class*="w2grid"])',
                                '[id*="loading"]:not([id*="grid"]):not([id*="w2grid"])'
                            ];
                            return loadingSelectors.some(sel => {
                                const el = document.querySelector(sel);
                                if (el && el.offsetParent !== null) {
                                    // 데이터 그리드 관련 요소는 제외
                                    const isGridElement = el.className.includes('grid') || 
                                                        el.id.includes('grid') ||
                                                        el.className.includes('w2grid') ||
                                                        el.id.includes('w2grid') ||
                                                        el.closest('[class*="grid"]') ||
                                                        el.closest('[id*="grid"]');
                                    return !isGridElement && el.offsetWidth > 50 && el.offsetHeight > 30;
                                }
                                return false;
                            });
                        },
                        
                        // 3. 실제 로딩 오버레이만 감지 (그리드 요소 제외)
                        () => {
                            const centerX = window.innerWidth / 2;
                            const centerY = window.innerHeight / 2;
                            const centerElement = document.elementFromPoint(centerX, centerY);
                            
                            if (centerElement) {
                                // 데이터 그리드 관련 요소인지 확인
                                const isGridElement = centerElement.className.includes('grid') || 
                                                    centerElement.id.includes('grid') ||
                                                    centerElement.className.includes('w2grid') ||
                                                    centerElement.id.includes('w2grid') ||
                                                    centerElement.closest('[class*="grid"]') ||
                                                    centerElement.closest('[id*="grid"]');
                                
                                if (isGridElement) {
                                    return false; // 그리드 요소는 로딩창이 아님
                                }
                                
                                const style = window.getComputedStyle(centerElement);
                                // 작은 오버레이만 로딩창으로 인식 (높이 100px 이하)
                                return (style.backgroundColor.includes('rgba') || 
                                       parseInt(style.zIndex) > 1000) &&
                                       centerElement.offsetWidth > window.innerWidth * 0.3 &&
                                       centerElement.offsetHeight < 100; // 높이 제한 추가
                            }
                            return false;
                        }
                    ];
                    
                    return checks.some(check => check());
                });
                
                if (hasLoading) {
                    loadingAppeared = true;
                    console.log('🔍 로딩창 감지됨');
                    break;
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
                attempts++;
            }
            
            if (!loadingAppeared) {
                console.log('⚠️ 로딩창이 감지되지 않음. 기본 대기 후 진행');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return;
            }
            
            // 3. 로딩창이 사라질 때까지 대기
            console.log('⏳ 로딩창이 사라질 때까지 대기 중...');
            let waitAttempts = 0;
            const maxWaitAttempts = 30; // 15초 대기 (500ms * 30)
            let consecutiveNoLoading = 0;
            
            while (waitAttempts < maxWaitAttempts) {
                const loadingStatus = await page.evaluate(() => {
                    const results = {
                        textCheck: false,
                        selectorCheck: false,
                        centerCheck: false,
                        details: []
                    };
                    
                    // 1. 정확한 로딩 텍스트 기반 감지
                    const loadingTexts = ['처리 중입니다.', '로딩 중...', 'Loading...', '잠시만 기다려 주세요'];
                    const allElements = document.getElementsByTagName('*');
                    for (let el of allElements) {
                        if (el.textContent) {
                            const text = el.textContent.trim();
                            if (loadingTexts.some(loadingText => text === loadingText)) {
                                if (el.offsetParent !== null) {
                                    results.textCheck = true;
                                    results.details.push(`텍스트 "${text}" 감지됨`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    // 2. 정확한 로딩 선택자만 감지 (그리드 제외)
                    const loadingSelectors = [
                        '#processMsgLayer',
                        '#__processbarIFrame', 
                        '.loading-spinner',
                        '[class*="loading"]:not([class*="grid"]):not([class*="w2grid"])',
                        '[id*="loading"]:not([id*="grid"]):not([id*="w2grid"])'
                    ];
                    for (const sel of loadingSelectors) {
                        const el = document.querySelector(sel);
                        if (el && el.offsetParent !== null) {
                            // 데이터 그리드 관련 요소는 제외
                            const isGridElement = el.className.includes('grid') || 
                                                el.id.includes('grid') ||
                                                el.className.includes('w2grid') ||
                                                el.id.includes('w2grid') ||
                                                el.closest('[class*="grid"]') ||
                                                el.closest('[id*="grid"]');
                            if (!isGridElement && el.offsetWidth > 50 && el.offsetHeight > 30) {
                                results.selectorCheck = true;
                                results.details.push(`로딩 선택자 "${sel}" 감지됨 (크기: ${el.offsetWidth}x${el.offsetHeight})`);
                                break;
                            }
                        }
                    }
                    
                    // 3. 실제 로딩 오버레이만 감지 (그리드 요소 제외)
                    const centerX = window.innerWidth / 2;
                    const centerY = window.innerHeight / 2;
                    const centerElement = document.elementFromPoint(centerX, centerY);
                    
                    if (centerElement) {
                        // 데이터 그리드 관련 요소인지 확인
                        const isGridElement = centerElement.className.includes('grid') || 
                                            centerElement.id.includes('grid') ||
                                            centerElement.className.includes('w2grid') ||
                                            centerElement.id.includes('w2grid') ||
                                            centerElement.closest('[class*="grid"]') ||
                                            centerElement.closest('[id*="grid"]');
                        
                        if (!isGridElement) {
                            const style = window.getComputedStyle(centerElement);
                            const hasRgba = style.backgroundColor.includes('rgba');
                            const hasHighZIndex = parseInt(style.zIndex) > 1000;
                            const isLargeEnough = centerElement.offsetWidth > window.innerWidth * 0.3;
                            const isSmallHeight = centerElement.offsetHeight < 100; // 높이 제한
                            
                            if ((hasRgba || hasHighZIndex) && isLargeEnough && isSmallHeight) {
                                results.centerCheck = true;
                                results.details.push(`로딩 오버레이 감지됨 (rgba: ${hasRgba}, z-index: ${style.zIndex}, 크기: ${centerElement.offsetWidth}x${centerElement.offsetHeight})`);
                            }
                        } else {
                            // 그리드 요소는 로딩창이 아님
                            results.details.push(`그리드 요소 감지됨 - 로딩창 아님 (${centerElement.className || centerElement.id})`);
                        }
                    }
                    
                    // 4. 추가 확인 (로딩 관련만)
                    // 4-1. 커서 상태 확인
                    if (document.body.style.cursor === 'wait' || document.body.style.cursor === 'progress') {
                        results.details.push('커서가 wait/progress 상태');
                    }
                    
                    // 4-2. 페이지 로딩 상태 확인
                    if (document.readyState !== 'complete') {
                        results.details.push(`문서 상태: ${document.readyState}`);
                    }
                    
                    results.isLoading = results.textCheck || results.selectorCheck || results.centerCheck;
                    return results;
                });
                
                if (!loadingStatus.isLoading) {
                    consecutiveNoLoading++;
                    console.log(`✅ 로딩 완료 확인 중... (${consecutiveNoLoading}/3)`);
                    if (loadingStatus.details.length > 0) {
                        console.log(`📋 현재 상태: ${loadingStatus.details.join(', ')}`);
                    }
                    if (consecutiveNoLoading >= 3) {
                        console.log('✅ 로딩창이 완전히 사라졌습니다.');
                        break;
                    }
                } else {
                    consecutiveNoLoading = 0;
                    console.log(`⏳ 로딩 중... (${waitAttempts + 1}/${maxWaitAttempts})`);
                    if (loadingStatus.details.length > 0) {
                        console.log(`🔍 감지된 로딩 요소: ${loadingStatus.details.join(', ')}`);
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
                waitAttempts++;
            }
            
            if (waitAttempts >= maxWaitAttempts) {
                console.log('⚠️ 로딩창 감지 타임아웃 (15초) - 계속 진행합니다.');
                
                // 타임아웃 시 현재 페이지 상태 디버깅
                const debugInfo = await page.evaluate(() => ({
                    url: window.location.href,
                    title: document.title,
                    readyState: document.readyState,
                    bodyText: document.body.textContent.substring(0, 200),
                    visibleElements: Array.from(document.querySelectorAll('*')).filter(el => el.offsetParent !== null).length
                }));
                console.log('🔍 타임아웃 시 페이지 상태:', debugInfo);
            }
            
            // 안전 대기
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('✅ 로딩 완료');
            
        } catch (error) {
            console.log('⚠️ 로딩창 감지 중 오류:', error.message);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    // 결제대상확인 페이지 대기 (기존 메서드 유지)
    async waitForPaymentConfirmationPage() {
        try {
            console.log('💳 결제대상확인 페이지 로딩 대기 중...');
            
            // 결제대상확인 페이지의 특징적인 요소가 나타날 때까지 대기
            await this.page.waitForSelector('text=결제대상확인', { timeout: 60000 }); // 60초로 증가
            console.log('✅ 결제대상확인 페이지가 로드되었습니다.');
            
            // 페이지가 완전히 로드될 때까지 추가 대기
            await this.page.waitForLoadState('domcontentloaded');
            await this.waitWithTimeout(2000); // 5초 → 2초로 단축
            
            // 결제 관련 요소들이 완전히 로드될 때까지 추가 대기
            console.log('⏳ 결제 화면 완전 로딩 대기 중... (3초)');
            await this.waitWithTimeout(3000); // 10초 → 3초로 단축
            
            console.log('✅ 결제 화면 로딩 완료 - 다음 법인 처리가 가능합니다.');
            
        } catch (error) {
            console.log('⚠️ 결제대상확인 페이지 대기 중 오류:', error.message);
            // 오류가 발생해도 충분한 시간 대기
            console.log('⏳ 안전을 위해 추가 대기 중... (5초)');
            await this.waitWithTimeout(5000);
        }
    }








    // 이전에 선택했던 체크박스 해제
    async uncheckPreviousSelection() {
        try {
            console.log('☑️ 체크된 체크박스 찾기 중...');
            
            // 체크된 체크박스 찾기 및 해제
            const uncheckedCount = await this.page.evaluate(() => {
                const checkedBoxes = document.querySelectorAll('input[type="checkbox"]:checked');
                console.log(`체크된 체크박스 수: ${checkedBoxes.length}`);
                
                let uncheckedCount = 0;
                checkedBoxes.forEach((checkbox, index) => {
                    console.log(`체크박스 ${index + 1} 해제 중...`);
                    checkbox.click();
                    uncheckedCount++;
                });
                
                return uncheckedCount;
            });
            
            if (uncheckedCount > 0) {
                console.log(`✅ ${uncheckedCount}개의 체크박스를 해제했습니다.`);
                
                // 체크박스 해제 후 페이지 안정화 대기
                await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
                
            } else {
                console.log('ℹ️ 해제할 체크박스가 없습니다.');
            }
            
        } catch (error) {
            console.log('⚠️ 체크박스 해제 중 오류:', error.message);
        }
    }

    // 이전 목록 페이지로 돌아가기
    async goToPreviousPage() {
        try {
            console.log('🔙 이전 목록 페이지로 돌아가는 중...');
            
            // 🔍 디버깅: 현재 페이지 상태 확인
            console.log(`🔍 현재 페이지 URL: ${this.page.url()}`);
            console.log(`🔍 현재 페이지 제목: ${await this.page.title()}`);
            
            // 현재 페이지가 관심등기 관리 페이지인지 확인
            const currentTitle = await this.page.title();
            const currentUrl = this.page.url();
            
            if (!currentTitle.includes('관심등기 관리') && !currentUrl.includes('interest')) {
                console.log('⚠️ 현재 페이지가 관심등기 관리 페이지가 아닙니다. 관심등기 관리 페이지로 이동합니다...');
                await this.navigateToInterestRegistry();
                return true;
            }
            
            // 여러 방법으로 이전 페이지 버튼 찾기
            let prevButton = null;
            
            // 방법 1: ID로 찾기
            try {
                prevButton = this.page.locator('#mf_wfm_potal_main_wfm_content_pgl_single2_prevPage_btn a');
                if (await prevButton.isVisible()) {
                    console.log('✅ ID로 이전 페이지 버튼을 찾았습니다.');
                } else {
                    prevButton = null;
                }
            } catch (e) {
                prevButton = null;
            }
            
            // 방법 2: XPath로 찾기 (수정된 버전)
            if (!prevButton) {
                try {
                    prevButton = this.page.locator('xpath=//a[contains(@onclick, "prevPage") or contains(@href, "prev")]');
                    if (await prevButton.isVisible()) {
                        console.log('✅ XPath로 이전 페이지 버튼을 찾았습니다.');
                    } else {
                        prevButton = null;
                    }
                } catch (e) {
                    prevButton = null;
                }
            }
            
            // 방법 3: 텍스트로 찾기
            if (!prevButton) {
                try {
                    prevButton = this.page.getByRole('link', { name: '이전 페이지' });
                    if (await prevButton.isVisible()) {
                        console.log('✅ 텍스트로 이전 페이지 버튼을 찾았습니다.');
                    } else {
                        prevButton = null;
                    }
                } catch (e) {
                    prevButton = null;
                }
            }
            
            // 방법 4: 모든 링크에서 "이전" 텍스트 찾기
            if (!prevButton) {
                try {
                    const allLinks = await this.page.locator('a').all();
                    console.log(`🔍 페이지의 모든 링크 수: ${allLinks.length}`);
                    
                    for (let i = 0; i < allLinks.length; i++) {
                        const link = allLinks[i];
                        const text = await link.textContent();
                        const isVisible = await link.isVisible();
                        
                        if (text && (text.includes('이전') || text.includes('prev') || text.includes('◀')) && isVisible) {
                            console.log(`✅ 링크에서 이전 버튼을 찾았습니다: "${text}"`);
                            prevButton = link;
                            break;
                        }
                    }
                } catch (e) {
                    console.log('⚠️ 링크 검색 중 오류:', e.message);
                }
            }
            
            // 버튼 클릭 시도
            if (prevButton) {
                try {
            const isVisible = await prevButton.isVisible();
            const isEnabled = await prevButton.isEnabled();
            console.log(`🔍 이전 페이지 버튼 상태 - 보임: ${isVisible}, 활성화: ${isEnabled}`);
            
            if (isVisible) {
                console.log('🖱️ 이전 페이지 버튼 클릭 실행...');
                await prevButton.click();
                await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
                console.log('✅ 이전 목록 페이지로 돌아갔습니다.');
                
                // 🔍 디버깅: 이동 후 상태 확인
                console.log(`🔍 이동 후 페이지 URL: ${this.page.url()}`);
                console.log(`🔍 이동 후 페이지 제목: ${await this.page.title()}`);
                
                return true;
                    }
                } catch (clickError) {
                    console.log('❌ 이전 페이지 버튼 클릭 실패:', clickError.message);
                }
            }
            
                console.log('⚠️ 이전 목록 페이지 버튼을 찾을 수 없습니다.');
            return false;
            
        } catch (error) {
            console.log('❌ 이전 목록 페이지 이동 실패:', error.message);
            console.log('🔍 오류 상세 정보:', error);
            return false;
        }
    }

    // 1페이지로 이동
    async goToFirstPage() {
        try {
            console.log('📄 1페이지로 이동 중...');
            
            // 🔍 디버깅: 현재 페이지 상태 확인
            console.log(`🔍 현재 페이지 URL: ${this.page.url()}`);
            console.log(`🔍 현재 페이지 제목: ${await this.page.title()}`);
            
            // 여러 방법으로 1페이지 버튼 찾기
            let firstPageButton = null;
            
            // 방법 1: "1" 텍스트로 찾기
            try {
                firstPageButton = this.page.getByRole('link', { name: '1' });
                if (await firstPageButton.isVisible()) {
                    console.log('✅ 텍스트로 1페이지 버튼을 찾았습니다.');
                } else {
                    firstPageButton = null;
                }
            } catch (e) {
                firstPageButton = null;
            }
            
            // 방법 2: 모든 링크에서 "1" 텍스트 찾기
            if (!firstPageButton) {
                try {
                    const allLinks = await this.page.locator('a').all();
                    console.log(`🔍 페이지의 모든 링크 수: ${allLinks.length}`);
                    
                    for (let i = 0; i < allLinks.length; i++) {
                        const link = allLinks[i];
                        const text = await link.textContent();
                        const isVisible = await link.isVisible();
                        
                        if (text && text.trim() === '1' && isVisible) {
                            console.log(`✅ 링크에서 1페이지 버튼을 찾았습니다: "${text}"`);
                            firstPageButton = link;
                            break;
                        }
                    }
                } catch (e) {
                    console.log('⚠️ 링크 검색 중 오류:', e.message);
                }
            }
            
            // 버튼 클릭 시도
            if (firstPageButton) {
                try {
                    const isVisible = await firstPageButton.isVisible();
                    const isEnabled = await firstPageButton.isEnabled();
                    console.log(`🔍 1페이지 버튼 상태 - 보임: ${isVisible}, 활성화: ${isEnabled}`);
                    
                    if (isVisible) {
                        console.log('🖱️ 1페이지 버튼 클릭 실행...');
                        await firstPageButton.click();
                        await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
                        console.log('✅ 1페이지로 이동했습니다.');
                        
                        // 🔍 디버깅: 이동 후 상태 확인
                        console.log(`🔍 이동 후 페이지 URL: ${this.page.url()}`);
                        console.log(`🔍 이동 후 페이지 제목: ${await this.page.title()}`);
                        
                        return true;
                    }
                } catch (clickError) {
                    console.log('❌ 1페이지 버튼 클릭 실패:', clickError.message);
                    }
                }
                
            console.log('⚠️ 1페이지 버튼을 찾을 수 없습니다.');
                return false;
            
        } catch (error) {
            console.log('❌ 1페이지 이동 실패:', error.message);
            console.log('🔍 오류 상세 정보:', error);
            return false;
        }
    }

    // 단일 법인 처리
    async processCompany(companyData, isLastCompany = false) {
        console.log(`\n🏢 "${companyData.등기상호}" 법인 처리 시작`);
        console.log(`📋 검색 조건: 등기상호="${companyData.등기상호}", 법인구분="${companyData.법인구분 || '없음'}", 관할등기소="${companyData.등기소 || '없음'}"`);
        
        try {
            // 1. 1페이지로 이동 (새로운 법인 처리를 위해)
            console.log('📄 새로운 법인 처리를 위해 1페이지로 이동합니다...');
            await this.goToFirstPage();
            
            // 2. 법인 찾기 및 선택 (체크박스 클릭까지 포함)
            const found = await this.findCompany(companyData);
            if (!found) {
                console.log(`❌ "${companyData.등기상호}" 법인을 찾을 수 없습니다.`);
                // 이미 1페이지에 있으므로 추가 이동 불필요
                console.log('🔙 법인을 찾지 못했습니다. 1페이지에 머물러 있습니다.');
                return false;
            }
            
            // 3. findCompany에서 이미 체크박스 상태를 확인했으므로 추가 확인 불필요
            console.log(`✅ "${companyData.등기상호}" 체크박스가 성공적으로 체크되었습니다.`);
            
            // 4. 열람/발급 버튼 클릭
            const viewClicked = await this.clickViewIssueButton();
            if (!viewClicked) {
                console.log(`❌ "${companyData.등기상호}" 열람/발급 버튼 클릭 실패`);
                return false;
            }
            
            // 5. 확인 버튼 클릭 및 새 탭 처리
            const confirmed = await this.confirmDetailsPopup();
            if (!confirmed) {
                console.log(`❌ "${companyData.등기상호}" 확인 버튼 클릭 실패`);
                return false;
            }
            
            // 6. 새 탭에서 로딩 완료 후 원래 탭으로 돌아가기
            try {
                if (isLastCompany) {
                    // 마지막 법인: 새 탭 닫지 않고 로딩만 대기
                    await this.waitForNewTabAndReturn(false);
                    console.log(`✅ "${companyData.등기상호}" 법인 처리 완료 (마지막 법인 - 새 탭 유지)`);
                } else {
                    // 일반 법인: 새 탭 닫고 이전 페이지로 이동
                    await this.waitForNewTabAndReturn(true);
                    console.log(`✅ "${companyData.등기상호}" 법인 처리 완료`);
                    
                    // 7. 법인 처리 완료 후 이전 페이지로 돌아가서 1페이지로 이동
                    console.log('🔙 이전 페이지로 돌아가서 1페이지로 이동합니다...');
                    await this.goToPreviousPage();
                    await this.goToFirstPage();
                }
                
            return true;
            } catch (error) {
                console.log(`⚠️ 새 탭 처리 중 오류: ${error.message}`);
                if (!isLastCompany) {
                    console.log('🔙 이전 페이지로 돌아가서 1페이지로 이동합니다...');
                    await this.goToPreviousPage();
                    await this.goToFirstPage();
                }
                return false;
            }
            
        } catch (error) {
            console.log(`❌ "${companyData.등기상호}" 법인 처리 중 오류:`, error.message);
            return false;
        }
    }

    // 여러 법인 처리 (배치 처리 방식)
    async processMultipleCompanies(companies) {
        console.log(`\n📋 총 ${companies.length}개 법인을 ${CONFIG.BATCH_SIZE}개씩 배치로 처리합니다.`);
        
        // 배치로 나누기
        const batches = [];
        for (let i = 0; i < companies.length; i += CONFIG.BATCH_SIZE) {
            batches.push(companies.slice(i, i + CONFIG.BATCH_SIZE));
        }
        
        console.log(`📦 총 ${batches.length}개 배치로 나누어 처리합니다.`);
        
        let totalSuccessCount = 0;
        let totalFailCount = 0;
        
        // 각 배치 처리
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchNumber = batchIndex + 1;
            
            try {
                console.log(`\n🚀 배치 ${batchNumber}/${batches.length} 시작`);
                
                // 배치 처리
                const result = await this.processBatch(batch, batchNumber);
                totalSuccessCount += result.success;
                totalFailCount += result.fail;
                
                // 마지막 배치가 아니면 메모리 정리 및 잠시 대기
                if (batchIndex < batches.length - 1) {
                    console.log(`\n⏳ 다음 배치 처리 전 정리 중...`);
                    await this.cleanupMemory();
                    await this.waitWithTimeout(5000); // 5초 대기
                    
                    // 페이지 상태 복구
                    await this.recoverPageState();
                }
                
            } catch (error) {
                console.log(`❌ 배치 ${batchNumber} 처리 중 오류: ${error.message}`);
                totalFailCount += batch.length; // 배치 전체를 실패로 처리
                
                // 오류 발생 시에도 다음 배치로 계속 진행
                if (batchIndex < batches.length - 1) {
                    console.log(`🔄 다음 배치로 계속 진행합니다...`);
                    await this.cleanupMemory();
                    await this.waitWithTimeout(5000);
                    await this.recoverPageState();
                }
            }
        }
        
        console.log(`\n🎉 모든 배치 처리 완료!`);
        console.log(`📊 최종 결과:`);
        console.log(`   총 처리: ${companies.length}개`);
        console.log(`   성공: ${totalSuccessCount}개`);
        console.log(`   실패: ${totalFailCount}개`);
        console.log(`   성공률: ${((totalSuccessCount / companies.length) * 100).toFixed(1)}%`);
        
        return { successCount: totalSuccessCount, failCount: totalFailCount };
    }

    // CSV 파일에서 자동화 실행
    async automateFromCSV(csvPath) {
        console.log('📁 CSV 파일에서 법인 목록을 읽어옵니다...');
        
        try {
            // 브라우저 시작 및 로그인 대기
            await this.start();
            await this.waitForLogin();
            
            // 관심등기 관리 페이지로 이동
            await this.navigateToInterestRegistry();
            
            // CSV 파일 읽기
            this.companies = await this.parseCSVData(csvPath);
            
            if (this.companies.length === 0) {
                console.log('❌ 처리할 법인이 없습니다.');
                return false;
            }
            
            // 모든 법인 정보 출력
            console.log(`\n📋 읽어온 법인 목록 (${this.companies.length}개):`);
            this.companies.forEach((company, index) => {
                console.log(`${index + 1}. ${company.등기상호} (${company.등기소}, ${company.법인구분})`);
            });
            
            // 여러 법인 처리
            const result = await this.processMultipleCompanies(this.companies);
            
            // 모든 처리 완료 후 결제 대기
            console.log('\n🎉 모든 법인 검색 완료!');
            console.log('💳 이제 결제를 진행해주세요.');
            
            // 결제 완료 대기
            await this.askQuestion('결제를 완료하셨나요? (완료하셨으면 Enter를 눌러주세요)');
            
            // 결제 후 열람/발급 자동화 실행
            await this.processPaymentAndDownload();
            
            return true;
            
        } catch (error) {
            console.log('❌ CSV 자동화 실행 중 오류:', error.message);
            return false;
        }
    }

    // 사용자 입력으로 자동화 실행
    async automateFromUserInput() {
        console.log('👤 사용자 입력으로 법인을 찾습니다...');
        
        try {
            // 브라우저 시작 및 로그인 대기
            await this.start();
            await this.waitForLogin();
            
            // 관심등기 관리 페이지로 이동
            await this.navigateToInterestRegistry();
            
            // 사용자 입력 받기
            this.companies = await this.getUserInput();
            
            if (this.companies.length === 0) {
                console.log('❌ 처리할 법인이 없습니다.');
                return false;
            }
            
            // 단일 법인 처리
            const success = await this.processCompany(this.companies[0]);
            
            if (success) {
                console.log('\n🎉 법인 검색 완료!');
                console.log('💳 이제 결제를 진행해주세요.');
                
                // 결제 완료 대기
                await this.askQuestion('결제를 완료하셨나요? (완료하셨으면 Enter를 눌러주세요)');
                
                // 결제 후 열람/발급 자동화 실행
                await this.processPaymentAndDownload();
            } else {
                console.log('\n❌ 법인 처리 실패');
            }
            
            return success;
            
        } catch (error) {
            console.log('❌ 사용자 입력 자동화 실행 중 오류:', error.message);
            return false;
        }
    }

    // 사용자 질문
    async askQuestion(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(question, () => {
                rl.close();
                resolve();
            });
        });
    }

    // 결제 완료 후 열람/발급 자동화
    async processPaymentAndDownload() {
        try {
            console.log('\n💳 결제 완료 후 열람/발급 자동화를 시작합니다...');
            
            // 1. 결제 완료 확인 대기
            console.log('⏳ 결제 완료를 기다리는 중...');
            await this.waitForPaymentCompletion();
            
            // 2. 모든 등기에 대해 순차적으로 열람/발급 처리
            await this.processAllRegistrations();
            
            console.log('\n🎉 모든 등기 열람/발급 처리가 완료되었습니다!');
            
        } catch (error) {
            console.log('❌ 결제 후 처리 중 오류:', error.message);
        }
    }

    // 결제 완료 대기
    async waitForPaymentCompletion() {
        try {
            // 결제 완료 화면이 나타날 때까지 대기
            await this.page.waitForSelector('h3[id*="wq_uuid"]', { 
                timeout: 60000,
                state: 'visible'
            });
            
            // 결제 완료 메시지 확인
            const paymentCompleteText = await this.page.textContent('h3[id*="wq_uuid"]');
            if (paymentCompleteText && paymentCompleteText.includes('신청결과')) {
                console.log('✅ 결제 완료 화면을 확인했습니다.');
                await this.waitWithTimeout(2000);
            }
            
        } catch (error) {
            console.log('⚠️ 결제 완료 화면을 찾을 수 없습니다. 계속 진행합니다.');
        }
    }

    // 모든 등기에 대해 순차적으로 처리
    async processAllRegistrations() {
        try {
            let registrationIndex = 0;
            let hasMoreRegistrations = true;
            
            while (hasMoreRegistrations) {
                console.log(`\n📋 등기 ${registrationIndex + 1} 처리 중...`);
                
                // 열람 버튼 찾기 및 클릭
                const viewButton = await this.findAndClickViewButton(registrationIndex);
                
                if (viewButton) {
                    // 열람 창에서 저장 및 처리
                    await this.handleViewWindow();
                    registrationIndex++;
                } else {
                    console.log('📋 더 이상 처리할 등기가 없습니다.');
                    hasMoreRegistrations = false;
                }
                
                // 다음 등기 처리 전 잠시 대기
                if (hasMoreRegistrations) {
                    await this.waitWithTimeout(1000);
                }
            }
            
        } catch (error) {
            console.log('❌ 등기 처리 중 오류:', error.message);
        }
    }

    // 열람 버튼 찾기 및 클릭
    async findAndClickViewButton(index) {
        try {
            // 열람/발급 버튼 찾기 (XPath 사용)
            const viewButtonXPath = `//button[@title="열람/발급" and contains(text(), "열람")]`;
            
            // 모든 열람 버튼 찾기
            const viewButtons = await this.page.locator('xpath=' + viewButtonXPath).all();
            
            if (viewButtons && viewButtons.length > index) {
                console.log(`🔍 열람 버튼 ${index + 1} 클릭 중...`);
                await viewButtons[index].click();
                await this.waitWithTimeout(2000);
                
                // 확인 대화상자 처리 (실제 테스트에서 확인됨)
                await this.handleConfirmationDialog();
                
                return true;
            } else {
                console.log(`❌ 열람 버튼 ${index + 1}을 찾을 수 없습니다.`);
                return false;
            }
            
        } catch (error) {
            console.log('❌ 열람 버튼 클릭 중 오류:', error.message);
            return false;
        }
    }

    // 확인 대화상자 처리
    async handleConfirmationDialog() {
        try {
            // 확인 대화상자가 나타나는지 확인 (실제 테스트에서 확인됨)
            const confirmDialog = await this.page.waitForSelector('button:has-text("확인")', { 
                timeout: 5000,
                state: 'visible'
            }).catch(() => null);
            
            if (confirmDialog) {
                console.log('⚠️ 확인 대화상자가 나타났습니다. "확인" 버튼을 클릭합니다.');
                await confirmDialog.click();
                console.log('✅ 확인 대화상자 처리 완료');
                await this.waitWithTimeout(2000); // 처리 완료 대기
            }
            
        } catch (error) {
            // 확인 대화상자가 없어도 정상적인 경우이므로 오류 로그만 출력
            console.log('ℹ️ 확인 대화상자가 없습니다. 계속 진행합니다.');
        }
    }

    // 열람 창 처리
    async handleViewWindow() {
        try {
            console.log('📄 열람 창에서 처리 중...');
            
            // 열람 창이 완전히 로드될 때까지 대기 (실제 테스트에서 확인됨)
            await this.waitForViewWindowToLoad();
            
            // 저장 버튼 클릭
            await this.clickDownloadButton();
            
            // change.py 실행
            await this.runChangePy();
            
            // 열람 창 닫기
            await this.closeViewWindow();
            
        } catch (error) {
            console.log('❌ 열람 창 처리 중 오류:', error.message);
        }
    }

    // 열람 창 로딩 대기
    async waitForViewWindowToLoad() {
        try {
            console.log('⏳ 열람 창 로딩 대기 중...');
            
            // "처리 중입니다" 로딩 화면이 사라지고 열람 창이 나타날 때까지 대기
            await this.page.waitForSelector('button:has-text("저장")', { 
                timeout: 30000,
                state: 'visible'
            });
            
            console.log('✅ 열람 창 로딩 완료');
            await this.waitWithTimeout(2000); // 추가 안정화 대기
            
        } catch (error) {
            console.log('⚠️ 열람 창 로딩 대기 중 오류:', error.message);
            // 로딩 실패해도 계속 진행
        }
    }

    // 저장 버튼 클릭
    async clickDownloadButton() {
        try {
            console.log('💾 저장 버튼 클릭 중...');
            
            // 저장 버튼 찾기 및 클릭 (실제 테스트에서 확인된 셀렉터)
            const downloadButton = await this.page.waitForSelector(
                'button:has-text("저장")', 
                { timeout: 10000 }
            );
            
            if (downloadButton) {
                await downloadButton.click();
                console.log('✅ 저장 버튼 클릭 완료');
                await this.waitWithTimeout(3000); // 다운로드 완료 대기
            }
            
        } catch (error) {
            console.log('❌ 저장 버튼 클릭 중 오류:', error.message);
        }
    }

    // change.py 실행
    async runChangePy() {
        try {
            console.log('🐍 change.py 실행 중...');
            
            const { spawn } = require('child_process');
            const path = require('path');
            
            // change.py 파일 경로 (현재 디렉토리의 상위 디렉토리/tts_stt/change.py)
            const changePyPath = path.join(__dirname, '..', 'tts_stt', 'change.py');
            
            return new Promise((resolve, reject) => {
                const pythonProcess = spawn('python', [changePyPath], {
                    stdio: 'inherit',
                    shell: true
                });
                
                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log('✅ change.py 실행 완료');
                        resolve();
                    } else {
                        console.log(`❌ change.py 실행 실패 (코드: ${code})`);
                        reject(new Error(`change.py 실행 실패: ${code}`));
                    }
                });
                
                pythonProcess.on('error', (error) => {
                    console.log('❌ change.py 실행 중 오류:', error.message);
                    reject(error);
                });
            });
            
        } catch (error) {
            console.log('❌ change.py 실행 중 오류:', error.message);
        }
    }

    // 열람 창 닫기
    async closeViewWindow() {
        try {
            console.log('❌ 열람 창 닫기 중...');
            
            // 창닫기 버튼 찾기 및 클릭 (실제 테스트에서 확인된 셀렉터)
            const closeButton = await this.page.waitForSelector(
                'a:has-text("창닫기")', 
                { timeout: 5000 }
            );
            
            if (closeButton) {
                await closeButton.click();
                console.log('✅ 열람 창 닫기 완료');
                await this.waitWithTimeout(1000);
            }
            
        } catch (error) {
            console.log('❌ 열람 창 닫기 중 오류:', error.message);
        }
    }

    // 웹페이지 완전 로딩 확인
    async waitForPageToBeReady() {
        try {
            console.log('⏳ 웹페이지 완전 로딩 대기 중...');
            
            // 1. DOM이 완전히 로드될 때까지 대기
            await this.page.waitForLoadState('domcontentloaded');
            
            // 2. 네트워크가 안정될 때까지 대기
            await this.page.waitForLoadState('networkidle');
            
            // 3. 주요 요소들이 로드될 때까지 대기
            await this.page.waitForSelector('body', { timeout: 10000 });
            
            // 4. 페이지가 완전히 렌더링될 때까지 추가 대기
            await this.waitWithTimeout(2000);
            
            // 5. 페이지 상태 확인
            const pageReady = await this.page.evaluate(() => {
                // document.readyState 확인
                if (document.readyState !== 'complete') {
                    console.log(`문서 상태: ${document.readyState}`);
                    return false;
                }
                
                // body 요소가 있는지 확인
                if (!document.body) {
                    console.log('body 요소가 없습니다');
                    return false;
                }
                
                // 기본적인 페이지 구조 확인
                const hasContent = document.body.children.length > 0;
                if (!hasContent) {
                    console.log('페이지 내용이 없습니다');
                    return false;
                }
                
                return true;
            });
            
            if (!pageReady) {
                console.log('⚠️ 페이지가 완전히 로드되지 않았습니다. 추가 대기 중...');
                await this.waitWithTimeout(3000);
            }
            
            console.log('✅ 웹페이지 완전 로딩 확인 완료');
            
        } catch (error) {
            console.log('⚠️ 웹페이지 로딩 확인 중 오류:', error.message);
            // 오류가 발생해도 기본 대기 시간은 확보
            await this.waitWithTimeout(5000);
        }
    }

    // 유틸리티 메서드들
    async waitWithTimeout(timeout) {
        await this.page.waitForTimeout(timeout);
    }

    // 재시도 로직이 포함된 안전한 실행 함수
    async executeWithRetry(operation, operationName, maxRetries = CONFIG.MAX_RETRIES) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 ${operationName} 시도 ${attempt}/${maxRetries}`);
                const result = await operation();
                if (attempt > 1) {
                    console.log(`✅ ${operationName} 성공 (${attempt}번째 시도)`);
                }
                return result;
            } catch (error) {
                lastError = error;
                console.log(`❌ ${operationName} 실패 (${attempt}/${maxRetries}): ${error.message}`);
                
                if (attempt < maxRetries) {
                    console.log(`⏳ ${CONFIG.RETRY_DELAY/1000}초 후 재시도...`);
                    await this.waitWithTimeout(CONFIG.RETRY_DELAY);
                    
                    // 재시도 전에 페이지 상태 확인 및 복구
                    await this.recoverPageState();
                }
            }
        }
        
        throw new Error(`${operationName} 최대 재시도 횟수 초과: ${lastError.message}`);
    }

    // 페이지 상태 복구 함수
    async recoverPageState() {
        try {
            console.log('🔧 페이지 상태 복구 중...');
            
            // 현재 URL 확인
            const currentUrl = this.page.url();
            console.log(`📍 현재 URL: ${currentUrl}`);
            
            // 관심등기 관리 페이지가 아니면 다시 이동
            if (!currentUrl.includes('interest') && !currentUrl.includes('관심등기')) {
                console.log('🔄 관심등기 관리 페이지로 재이동...');
                await this.navigateToInterestRegistry();
            }
            
            // 팝업 제거
            await this.removePopupsAfterLogin();
            
            console.log('✅ 페이지 상태 복구 완료');
        } catch (error) {
            console.log('⚠️ 페이지 상태 복구 중 오류:', error.message);
        }
    }

    // 메모리 정리 함수
    async cleanupMemory() {
        try {
            console.log('🧹 메모리 정리 중...');
            
            // 모든 탭 닫기 (원래 탭 제외)
            const pages = this.context.pages();
            for (let i = 1; i < pages.length; i++) {
                try {
                    await pages[i].close();
                } catch (error) {
                    console.log(`⚠️ 탭 ${i} 닫기 실패: ${error.message}`);
                }
            }
            
            // 가비지 컬렉션 강제 실행 (Node.js에서 사용 가능한 경우)
            if (global.gc) {
                global.gc();
                console.log('🗑️ 가비지 컬렉션 실행');
            }
            
            // 잠시 대기
            await this.waitWithTimeout(1000);
            
            console.log('✅ 메모리 정리 완료');
        } catch (error) {
            console.log('⚠️ 메모리 정리 중 오류:', error.message);
        }
    }

    // 배치 처리 함수
    async processBatch(batch, batchNumber) {
        console.log(`\n📦 배치 ${batchNumber} 처리 시작 (${batch.length}개 법인)`);
        this.currentBatch = batchNumber;
        
        let batchSuccessCount = 0;
        let batchFailCount = 0;
        
        for (let i = 0; i < batch.length; i++) {
            const company = batch[i];
            const isLastInBatch = (i === batch.length - 1);
            const globalIndex = (batchNumber - 1) * CONFIG.BATCH_SIZE + i + 1;
            
            console.log(`\n📊 전체 진행률: ${globalIndex}/${this.companies.length} (배치 ${batchNumber}/${Math.ceil(this.companies.length / CONFIG.BATCH_SIZE)})`);
            console.log(`🏢 처리 중: ${company.등기상호}`);
            
            try {
                const success = await this.executeWithRetry(
                    () => this.processCompany(company, isLastInBatch),
                    `${company.등기상호} 처리`
                );
                
                if (success) {
                    batchSuccessCount++;
                    this.successCount++;
                    console.log(`✅ ${company.등기상호} 처리 완료`);
                } else {
                    batchFailCount++;
                    this.failCount++;
                    console.log(`❌ ${company.등기상호} 처리 실패`);
                }
                
                this.processedCount++;
                
                // 다음 법인 처리 전 잠시 대기
                if (i < batch.length - 1) {
                    await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
                }
                
            } catch (error) {
                batchFailCount++;
                this.failCount++;
                this.processedCount++;
                console.log(`❌ ${company.등기상호} 처리 중 예외 발생: ${error.message}`);
                
                // 오류 발생 시에도 다음 법인으로 계속 진행
                continue;
            }
        }
        
        console.log(`\n📊 배치 ${batchNumber} 완료: 성공 ${batchSuccessCount}개, 실패 ${batchFailCount}개`);
        return { success: batchSuccessCount, fail: batchFailCount };
    }

    async cleanup() {
        try {
            console.log('🧹 전체 정리 시작...');
            
            // 메모리 정리
            await this.cleanupMemory();
            
            // 브라우저 종료
            if (this.browser) {
                await this.browser.close();
                console.log('🧹 브라우저 정리 완료');
            }
            
            // 최종 통계 출력
            console.log(`\n📊 전체 처리 결과:`);
            console.log(`   총 처리: ${this.processedCount}개`);
            console.log(`   성공: ${this.successCount}개`);
            console.log(`   실패: ${this.failCount}개`);
            console.log(`   성공률: ${this.processedCount > 0 ? ((this.successCount / this.processedCount) * 100).toFixed(1) : 0}%`);
            
        } catch (error) {
            console.log('⚠️ 정리 중 오류:', error.message);
        }
    }
}

// 메인 함수
async function main() {
    const automation = new IROSFindAutomation();
    
    try {
        const csvPath = 'find_data.csv';
        
        // CSV 파일 존재 여부 확인
        if (fs.existsSync(csvPath)) {
            console.log('📁 find_data.csv 파일을 발견했습니다.');
            await automation.automateFromCSV(csvPath);
        } else {
            console.log('📁 find_data.csv 파일이 없습니다. 사용자 입력을 받습니다.');
            await automation.automateFromUserInput();
        }
        
        // 모든 처리가 완료되면 브라우저 유지
        console.log('\n🎉 모든 작업이 완료되었습니다!');
        console.log('💡 브라우저를 닫으면 프로그램이 자동으로 종료됩니다.');
        await automation.askQuestion('Enter를 눌러 프로그램을 종료하거나 브라우저를 닫으세요...');
        
        // 정상 종료 시에도 cleanup 호출
        await automation.cleanup();
        
    } catch (error) {
        console.log('❌ 프로그램 실행 중 오류:', error.message);
        await automation.cleanup();
        process.exit(1);
    }
}

// 프로그램 실행
if (require.main === module) {
    main().catch(console.error);
}

module.exports = IROSFindAutomation;
