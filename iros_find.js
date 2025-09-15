const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');

// 전역 설정 객체
const CONFIG = {
    BATCH_SIZE: 10,
    TIMEOUTS: {
        DEFAULT: 2000,
        LOADING: 3000,
        LONG: 5000,
        SELECTOR: 10000,
        LONG_SELECTOR: 15000,
        VERY_LONG: 30000
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
        this.page = null;
        this.companies = [];
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
        
        this.page = await this.browser.newPage();
        
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
            timeout: 30000
        });
        
        // 4단계: 페이지 완전 로딩 대기
        await this.page.waitForLoadState('domcontentloaded');
        await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT); // 추가 로딩 시간
        
        // 5단계: 팝업 및 배너 즉시 제거
        console.log('🧹 팝업 및 배너 제거 시작...');
        const removedCount = await this.page.evaluate(() => {
            let removedCount = 0;
            
            // 모든 가능한 닫기 버튼들 찾기
            const closeButtons = document.querySelectorAll('[class*="close"], [class*="popup"], [class*="modal"], button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close, .close-btn, [alt*="닫기"], [alt*="close"]');
            closeButtons.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.click();
                    removedCount++;
                    console.log('닫기 버튼 클릭:', btn);
                }
            });
            
            // "오늘 다시 보지 않기" 링크 클릭
            const allLinks = document.querySelectorAll('a');
            allLinks.forEach(link => {
                if (link.textContent && link.textContent.includes('오늘 다시 보지 않기') && link.offsetParent !== null) {
                    link.click();
                    removedCount++;
                    console.log('오늘 다시 보지 않기 클릭:', link);
                }
            });
            
            // 팝업 요소들만 정교하게 숨기기 (메인 콘텐츠 제외)
            const popupElements = document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"], [class*="modal"], [id*="modal"]');
            popupElements.forEach(el => {
                // 메인 콘텐츠나 중요한 페이지 요소는 제외
                const isMainContent = el.closest('#content, .content, .main, #main, .container, #container, .page, #page');
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

    // 로그인 후 팝업 및 배너 제거
    async removePopupsAfterLogin() {
        try {
            // 페이지 로딩 완료 대기
            await this.page.waitForLoadState('domcontentloaded');
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            
            const removedCount = await this.page.evaluate(() => {
                let removedCount = 0;
                
                // 모든 가능한 닫기 버튼들 찾기
                const closeButtons = document.querySelectorAll('[class*="close"], [class*="popup"], [class*="modal"], button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close, .close-btn, [alt*="닫기"], [alt*="close"]');
                closeButtons.forEach(btn => {
                    if (btn.offsetParent !== null) {
                        btn.click();
                        removedCount++;
                        console.log('로그인 후 닫기 버튼 클릭:', btn);
                    }
                });
                
                // "오늘 다시 보지 않기" 링크 클릭
                const allLinks = document.querySelectorAll('a');
                allLinks.forEach(link => {
                    if (link.textContent && link.textContent.includes('오늘 다시 보지 않기') && link.offsetParent !== null) {
                        link.click();
                        removedCount++;
                        console.log('로그인 후 오늘 다시 보지 않기 클릭:', link);
                    }
                });
                
                // 팝업 요소들만 정교하게 숨기기 (메인 콘텐츠 제외)
                const popupElements = document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"], [class*="modal"], [id*="modal"]');
                popupElements.forEach(el => {
                    // 메인 콘텐츠나 중요한 페이지 요소는 제외
                    const isMainContent = el.closest('#content, .content, .main, #main, .container, #container, .page, #page');
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
                
                // 배너 및 광고 요소들만 정교하게 숨기기 (메인 콘텐츠 제외)
                const bannerElements = document.querySelectorAll('[class*="banner"], [id*="banner"], [class*="ad"], [id*="ad"], [class*="notice"], [id*="notice"]');
                bannerElements.forEach(el => {
                    // 메인 콘텐츠나 중요한 페이지 요소는 제외
                    const isMainContent = el.closest('#content, .content, .main, #main, .container, #container, .page, #page');
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
            await this.page.getByRole('link', { name: '나의 등기정보' }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            
            // 관심등기 관리 클릭
            await this.page.getByRole('link', { name: '관심등기 관리' }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
            
            // 관심법인 탭 클릭
            await this.page.getByRole('link', { name: '관심법인' }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            
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
                    for (let row of rows) {
                        const cells = row.querySelectorAll('td');
                        // 상호명은 3번째 컬럼 (인덱스 2)에 있음
                        if (cells.length > 2 && cells[2].textContent.trim()) {
                            companies.push(cells[2].textContent.trim());
                        }
                    }
                    return companies;
                });
            
            console.log(`🔍 현재 페이지의 모든 법인명: [${allCompanies.join(', ')}]`);
            
            // JavaScript를 사용하여 법인명과 상세 정보 검색
            const found = await this.page.evaluate((data) => {
                const rows = document.querySelectorAll('tr');
                console.log(`🔍 검색 대상: "${data.등기상호}"`);
                console.log(`🔍 법인구분: "${data.법인구분 || '없음'}"`);
                console.log(`🔍 관할등기소: "${data.등기소 || '없음'}"`);
                
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowText = row.textContent;
                    
                    // 1. 등기상호로 먼저 검색
                    if (rowText.includes(data.등기상호)) {
                        console.log(`✅ 등기상호 "${data.등기상호}" 발견 (행 ${i})`);
                        console.log(`📋 행 내용: "${rowText}"`);
                        
                        // 2. 법인구분이 있으면 확인
                        if (data.법인구분 && data.법인구분.trim() && !rowText.includes(data.법인구분)) {
                            console.log(`⚠️ 법인구분 불일치: 예상 "${data.법인구분}", 실제 행: "${rowText}"`);
                            continue; // 다음 행으로
                        }
                        
                        // 3. 관할등기소가 있으면 확인
                        if (data.등기소 && data.등기소.trim() && !rowText.includes(data.등기소)) {
                            console.log(`⚠️ 관할등기소 불일치: 예상 "${data.등기소}", 실제 행: "${rowText}"`);
                            continue; // 다음 행으로
                        }
                        
                        console.log(`✅ 모든 조건 일치: "${data.등기상호}"`);
                        return true;
                    }
                }
                console.log(`❌ "${data.등기상호}" 법인을 찾을 수 없습니다.`);
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
            // 현재 페이지 정보 수집 (페이지 변경 확인용)
            const currentPageInfo = await this.page.evaluate(() => {
                const rows = document.querySelectorAll('tr');
                const companies = [];
                for (let row of rows) {
                    const cells = row.querySelectorAll('td');
                    // 상호명은 3번째 컬럼 (인덱스 2)에 있음
                    if (cells.length > 2 && cells[2].textContent.trim()) {
                        companies.push(cells[2].textContent.trim());
                    }
                }
                
                // 현재 활성화된 페이지 번호 찾기 (실제 페이지 구조 분석 결과 반영)
                const activePageButton = document.querySelector('.w2pageList_control_pageNum.w2pageList_col_pageNum.w2pageList_control_pageNum_active');
                const currentPageNum = activePageButton ? parseInt(activePageButton.textContent.trim()) : 1;
                
                return {
                    firstCompany: companies[0] || null,
                    allCompanies: companies,
                    currentPageNum: currentPageNum,
                    totalCompanies: companies.length
                };
            });
            
            console.log(`🔍 현재 페이지 정보:`);
            console.log(`   📄 페이지 번호: ${currentPageInfo.currentPageNum}`);
            console.log(`   🏢 첫 번째 법인: "${currentPageInfo.firstCompany}"`);
            console.log(`   📊 총 법인 수: ${currentPageInfo.totalCompanies}`);
            console.log(`   📋 모든 법인: [${currentPageInfo.allCompanies.join(', ')}]`);
            
            // "다음 페이지" 버튼 찾기 (더 안정적인 방식)
            const nextButton = this.page.getByRole('link', { name: '다음 페이지' });
            
            if (await nextButton.isVisible()) {
                console.log('📄 다음 페이지 버튼을 클릭합니다...');
                await nextButton.click();
                
                // 페이지 로딩 완료까지 대기
                await this.page.waitForLoadState('domcontentloaded');
                await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
                
                // 페이지 변경 감지 (여러 방법으로 확인)
                let pageChanged = false;
                let attempts = 0;
                const maxAttempts = 3;
                
                while (attempts < maxAttempts && !pageChanged) {
                    const newPageInfo = await this.page.evaluate(() => {
                        const rows = document.querySelectorAll('tr');
                        const companies = [];
                        for (let row of rows) {
                            const cells = row.querySelectorAll('td');
                            // 상호명은 3번째 컬럼 (인덱스 2)에 있음
                            if (cells.length > 2 && cells[2].textContent.trim()) {
                                companies.push(cells[2].textContent.trim());
                            }
                        }
                        
                        // 현재 활성화된 페이지 번호 찾기 (실제 페이지 구조 분석 결과 반영)
                        const activePageButton = document.querySelector('.w2pageList_control_pageNum.w2pageList_col_pageNum.w2pageList_control_pageNum_active');
                        const currentPageNum = activePageButton ? parseInt(activePageButton.textContent.trim()) : 1;
                        
                        return {
                            firstCompany: companies[0] || null,
                            allCompanies: companies,
                            currentPageNum: currentPageNum,
                            totalCompanies: companies.length
                        };
                    });
                    
                    console.log(`🔍 새 페이지 정보 (시도 ${attempts + 1}):`);
                    console.log(`   📄 페이지 번호: ${newPageInfo.currentPageNum}`);
                    console.log(`   🏢 첫 번째 법인: "${newPageInfo.firstCompany}"`);
                    console.log(`   📊 총 법인 수: ${newPageInfo.totalCompanies}`);
                    console.log(`   📋 모든 법인: [${newPageInfo.allCompanies.join(', ')}]`);
                    
                    // 페이지 변경 확인 (여러 조건으로 검증)
                    const pageNumChanged = newPageInfo.currentPageNum !== currentPageInfo.currentPageNum;
                    const firstCompanyChanged = newPageInfo.firstCompany !== currentPageInfo.firstCompany;
                    const contentChanged = JSON.stringify(newPageInfo.allCompanies) !== JSON.stringify(currentPageInfo.allCompanies);
                    
                    if (pageNumChanged || firstCompanyChanged || contentChanged) {
                        pageChanged = true;
                        console.log(`✅ 페이지 변경 감지됨!`);
                        console.log(`   📄 페이지 번호: ${currentPageInfo.currentPageNum} → ${newPageInfo.currentPageNum}`);
                        console.log(`   🏢 첫 번째 법인: "${currentPageInfo.firstCompany}" → "${newPageInfo.firstCompany}"`);
                        console.log(`   📊 법인 수: ${currentPageInfo.totalCompanies} → ${newPageInfo.totalCompanies}`);
                        return { success: true };
                    }
                    
                    // 아직 변경되지 않았다면 잠시 대기 후 재시도
                    if (attempts < maxAttempts - 1) {
                        console.log(`⏳ 페이지 변경 대기 중... (${attempts + 1}/${maxAttempts})`);
                        await this.waitWithTimeout(1000);
                    }
                    
                    attempts++;
                }
                
                if (!pageChanged) {
                    console.log(`⚠️ 다음 페이지 버튼을 클릭했지만 페이지가 변경되지 않았습니다. (마지막 페이지)`);
                    return { success: false, isLastPage: true };
                }
            } else {
                console.log(`📄 다음 페이지 버튼이 없습니다. (마지막 페이지)`);
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
            // JavaScript를 사용하여 체크박스 클릭
            const clicked = await this.page.evaluate((data) => {
                const rows = document.querySelectorAll('tr');
                for (let row of rows) {
                    const rowText = row.textContent;
                    
                    // 1. 등기상호로 먼저 검색
                    if (rowText.includes(data.등기상호)) {
                        console.log(`✅ 등기상호 "${data.등기상호}" 발견`);
                        
                        // 2. 법인구분이 있으면 확인
                        if (data.법인구분 && data.법인구분.trim() && !rowText.includes(data.법인구분)) {
                            console.log(`⚠️ 법인구분 불일치: 예상 "${data.법인구분}", 실제 행: "${rowText}"`);
                            continue; // 다음 행으로
                        }
                        
                        // 3. 관할등기소가 있으면 확인
                        if (data.등기소 && data.등기소.trim() && !rowText.includes(data.등기소)) {
                            console.log(`⚠️ 관할등기소 불일치: 예상 "${data.등기소}", 실제 행: "${rowText}"`);
                            continue; // 다음 행으로
                        }
                        
                        // 4. 모든 조건이 일치하면 체크박스 클릭
                        const checkbox = row.querySelector('input[type="checkbox"]');
                        if (checkbox) {
                            checkbox.click();
                            console.log(`✅ 체크박스 클릭 완료: "${data.등기상호}"`);
                            return true;
                        }
                    }
                }
                return false;
            }, companyData);
            
            if (clicked) {
                console.log(`✅ "${companyData.등기상호}" 법인 선택 완료`);
                return true;
            } else {
                console.log(`❌ "${companyData.등기상호}" 법인 체크박스를 찾을 수 없습니다.`);
                return false;
            }
        } catch (error) {
            console.log(`❌ "${companyData.등기상호}" 법인 선택 실패:`, error.message);
            return false;
        }
    }

    // 열람/발급 버튼 클릭
    async clickViewIssueButton() {
        console.log('📄 열람/발급 버튼을 클릭합니다...');
        
        try {
            await this.page.getByRole('link', { name: '열람/발급', exact: true }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            console.log('✅ 열람/발급 버튼 클릭 완료');
            return true;
        } catch (error) {
            console.log('❌ 열람/발급 버튼 클릭 실패:', error.message);
            return false;
        }
    }

    // 세부사항 선택 팝업에서 확인 버튼 클릭 및 새 웹페이지 처리
    async confirmDetailsPopup() {
        console.log('✅ 세부사항 선택 팝업에서 확인 버튼을 클릭합니다...');
        
        try {
            // 확인 버튼 클릭
            await this.page.getByRole('link', { name: '확인', exact: true }).click();
            await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
            console.log('✅ 확인 버튼 클릭 완료');
            
            // 새 웹페이지가 열릴 때까지 대기
            console.log('⏳ 새 웹페이지 열림을 기다리는 중...');
            await this.waitForNewPageAndProcess();
            
            return true;
        } catch (error) {
            console.log('❌ 확인 버튼 클릭 실패:', error.message);
            return false;
        }
    }

    // 새 웹페이지 열림 대기 및 결제대상확인 페이지까지 처리
    async waitForNewPageAndProcess() {
        try {
            // 새 탭이 열릴 때까지 대기
            const newPagePromise = this.browser.waitForEvent('page');
            const newPage = await newPagePromise;
            
            console.log('📄 새 웹페이지가 열렸습니다.');
            
            // 새 페이지로 전환
            this.page = newPage;
            
            // 결제대상확인 페이지가 나올 때까지 대기
            console.log('⏳ 결제대상확인 페이지 로딩을 기다리는 중...');
            await this.waitForPaymentConfirmationPage();
            
            // 원래 탭으로 돌아가기
            console.log('🔙 원래 탭으로 돌아가는 중...');
            await this.returnToOriginalTab();
            
        } catch (error) {
            console.log('❌ 새 웹페이지 처리 중 오류:', error.message);
        }
    }

    // 결제대상확인 페이지 대기
    async waitForPaymentConfirmationPage() {
        try {
            // 결제대상확인 페이지의 특징적인 요소가 나타날 때까지 대기
            await this.page.waitForSelector('text=결제대상확인', { timeout: 30000 });
            console.log('✅ 결제대상확인 페이지가 로드되었습니다.');
            
            // 페이지가 완전히 로드될 때까지 추가 대기
            await this.page.waitForLoadState('domcontentloaded');
            await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            
        } catch (error) {
            console.log('⚠️ 결제대상확인 페이지 대기 중 오류:', error.message);
        }
    }

    // 원래 탭으로 돌아가기
    async returnToOriginalTab() {
        try {
            // 모든 탭 목록 가져오기
            const pages = this.browser.pages();
            
            // 첫 번째 탭(원래 탭)으로 돌아가기
            if (pages.length > 1) {
                this.page = pages[0];
                console.log('✅ 원래 탭으로 돌아왔습니다.');
            } else {
                console.log('⚠️ 원래 탭을 찾을 수 없습니다.');
            }
            
        } catch (error) {
            console.log('❌ 원래 탭으로 돌아가기 실패:', error.message);
        }
    }

    // 이전 목록 페이지로 돌아가기
    async goToPreviousPage() {
        try {
            console.log('🔙 이전 목록 페이지로 돌아가는 중...');
            
            // 이전 목록 페이지 버튼 클릭 (li > a 구조)
            const prevButton = this.page.locator('#mf_wfm_potal_main_wfm_content_pgl_single2_prevPage_btn a');
            if (await prevButton.isVisible()) {
                await prevButton.click();
                await this.waitWithTimeout(CONFIG.TIMEOUTS.LOADING);
                console.log('✅ 이전 목록 페이지로 돌아갔습니다.');
                return true;
            } else {
                console.log('⚠️ 이전 목록 페이지 버튼을 찾을 수 없습니다.');
                return false;
            }
        } catch (error) {
            console.log('❌ 이전 목록 페이지 이동 실패:', error.message);
            return false;
        }
    }

    // 단일 법인 처리 (한 번에 한 건씩)
    async processCompany(companyData) {
        console.log(`\n🏢 "${companyData.등기상호}" 법인 처리 시작`);
        console.log(`📋 검색 조건: 등기상호="${companyData.등기상호}", 법인구분="${companyData.법인구분 || '없음'}", 관할등기소="${companyData.등기소 || '없음'}"`);
        
        try {
            // 1. 법인 찾기
            const found = await this.findCompany(companyData);
            if (!found) {
                console.log(`❌ "${companyData.등기상호}" 법인을 찾을 수 없습니다.`);
                // 마지막 페이지에서 다음 상호로 넘어갈 때 이전 목록 페이지로 돌아가기
                await this.goToPreviousPage();
                return false;
            }
            
            // 2. 법인 선택
            const selected = await this.selectCompany(companyData);
            if (!selected) {
                console.log(`❌ "${companyData.등기상호}" 법인 선택 실패`);
                return false;
            }
            
            // 3. 열람/발급 버튼 클릭
            const viewClicked = await this.clickViewIssueButton();
            if (!viewClicked) {
                console.log(`❌ "${companyData.등기상호}" 열람/발급 버튼 클릭 실패`);
                return false;
            }
            
            // 4. 확인 버튼 클릭 및 새 웹페이지 처리
            const confirmed = await this.confirmDetailsPopup();
            if (!confirmed) {
                console.log(`❌ "${companyData.등기상호}" 확인 버튼 클릭 실패`);
                return false;
            }
            
            console.log(`✅ "${companyData.등기상호}" 법인 처리 완료 (결제대상확인 페이지까지 완료)`);
            return true;
            
        } catch (error) {
            console.log(`❌ "${companyData.등기상호}" 법인 처리 중 오류:`, error.message);
            return false;
        }
    }

    // 여러 법인 처리
    async processMultipleCompanies(companies) {
        console.log(`\n📋 총 ${companies.length}개 법인을 처리합니다.`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < companies.length; i++) {
            const company = companies[i];
            console.log(`\n📊 진행률: ${i + 1}/${companies.length}`);
            
            const success = await this.processCompany(company);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            
            // 다음 법인 처리 전 잠시 대기
            if (i < companies.length - 1) {
                await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
            }
        }
        
        console.log(`\n📊 처리 결과:`);
        console.log(`✅ 성공: ${successCount}개`);
        console.log(`❌ 실패: ${failCount}개`);
        
        return { successCount, failCount };
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
            
            // 모든 처리 완료 후 사용자에게 완료 알림
            console.log('\n🎉 모든 법인 처리 완료!');
            console.log('💡 브라우저를 닫으면 프로그램이 자동으로 종료됩니다.');
            console.log('💡 또는 터미널에서 Enter를 눌러 프로그램을 종료할 수 있습니다.');
            
            // 사용자가 수동으로 종료할 때까지 대기 (브라우저 닫기로도 종료 가능)
            await this.askQuestion('모든 작업이 완료되었습니다. Enter를 눌러 프로그램을 종료하거나 브라우저를 닫으세요...');
            
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
                console.log('\n🎉 법인 처리 완료!');
                console.log('💡 브라우저를 닫으면 프로그램이 자동으로 종료됩니다.');
                console.log('💡 또는 터미널에서 Enter를 눌러 프로그램을 종료할 수 있습니다.');
                
                await this.askQuestion('작업이 완료되었습니다. Enter를 눌러 프로그램을 종료하거나 브라우저를 닫으세요...');
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

    // 유틸리티 메서드들
    async waitWithTimeout(timeout) {
        await this.page.waitForTimeout(timeout);
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🧹 브라우저 정리 완료');
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
