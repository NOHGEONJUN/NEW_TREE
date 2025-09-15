const { chromium } = require('playwright');
const readline = require('readline');
const fs = require('fs');

// 설정 객체 - 하드코딩된 값들을 중앙 관리
const CONFIG = {
    BATCH_SIZE: 10,
    TIMEOUTS: {
        DEFAULT: 2000,
        LOADING: 3000,
        LONG: 5000,
        SELECTOR: 10000,
        LONG_SELECTOR: 20000,
        VERY_LONG: 30000
    },
    SELECTORS: {
        BUTTONS: {
            NEXT: '#mf_wfm_potal_main_wfm_content_btn_next',
            SEARCH: '#mf_wfm_potal_main_wfm_content_btn_conm_search',
            PAY: '#mf_wfm_potal_main_wfm_content_btn_pay',
            ADD: '#mf_wfm_potal_main_wfm_content_btn_new_add',
            FIRST: '#mf_wfm_potal_main_wfm_content_btn_first',
            HOME: '#mf_wfm_potal_main_wf_header_btn_home'
        },
        INPUTS: {
            COMPANY: '#mf_wfm_potal_main_wfm_content_sbx_conm___input'
        },
        ELEMENTS: {
            LOADING_FRAME: '#__processbarIFrame',
            DUPLICATE_PAYMENT: '#mf_wfm_potal_main_wfm_content_wq_uuid_14688',
            NO_RESULTS: '//*[@id="mf_wfm_potal_main_wfm_content_wq_uuid_4536"]/b/span'
        }
    },
    REGISTRY_ITEMS: ['14', '15'],
    DEFAULT_VALUES: {
        REGISTRY_OFFICE: '전체등기소',
        CORPORATION_TYPE: '전체 법인(지배인, 미성년자, 법정대리인 제외)',
        REGISTRY_STATUS: '살아있는 등기',
        BRANCH_TYPE: '전체 본지점',
        WEEKEND_OPTION: 'N'
    }
};

class IROSAutomation {
    constructor() {
        this.browser = null;
        this.page = null;
        this.processedCompanies = [];
        this.failedCompanies = [];
        
        // readline 인터페이스 설정
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
        });
    }

    // 공통 유틸리티 메서드 - 중복된 버튼 클릭 로직 통합
    async clickElementWithFallback(primarySelector, fallbackSelector, elementName) {
        try {
            await this.page.waitForSelector(primarySelector, { timeout: CONFIG.TIMEOUTS.SELECTOR });
            await this.page.click(primarySelector);
            console.log(`✅ ${elementName} 클릭 성공 (정확한 ID)`);
            return true;
        } catch (e) {
            try {
                await this.page.click(fallbackSelector);
                console.log(`✅ ${elementName} 클릭 성공 (대안 방법)`);
                return true;
            } catch (e2) {
                console.log(`❌ ${elementName} 클릭 실패`);
                return false;
            }
        }
    }

    // 공통 대기 메서드
    async waitWithTimeout(timeout = CONFIG.TIMEOUTS.DEFAULT) {
        await this.page.waitForTimeout(timeout);
    }

    async start() {
        console.log('🚀 IROS 법인등기 자동화 시작...');
        
        // 1단계: 브라우저 실행 (완전 최대화)
        this.browser = await chromium.launch({ 
            headless: false,
            channel: 'chrome',
            args: [
                '--start-maximized',
                '--kiosk',  // 전체 화면 모드
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
            
            // 팝업 요소들 숨기기
            const popupElements = document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"], [class*="modal"], [id*="modal"]');
            popupElements.forEach(el => {
                if (el.offsetParent !== null) {
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
        
        // 7단계: 추가 대기 후 다시 한 번 팝업 제거
        await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
        const additionalRemoved = await this.page.evaluate(() => {
            let count = 0;
            document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"]').forEach(el => {
                if (el.offsetParent !== null) {
                    el.style.display = 'none';
                    count++;
                }
            });
            return count;
        });
        
        if (additionalRemoved > 0) {
            console.log(`🧹 추가로 ${additionalRemoved}개의 요소가 제거되었습니다.`);
        }
        
        // 8단계: 최종 확인
        const finalCheck = await this.page.evaluate(() => {
            const loginElements = Array.from(document.querySelectorAll('a')).filter(el => 
                el.textContent && el.textContent.includes('로그인')
            );
            
            return {
                loginFound: loginElements.length > 0,
                loginCount: loginElements.length,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                pageTitle: document.title
            };
        });
        
        console.log(`📄 페이지 제목: ${finalCheck.pageTitle}`);
        console.log(`📏 최종 브라우저 크기: ${finalCheck.windowWidth}x${finalCheck.windowHeight}`);
        
        if (finalCheck.loginFound) {
            console.log(`✅ 로그인 버튼이 ${finalCheck.loginCount}개 확인되었습니다.`);
            console.log('🎉 UI가 완전히 표시되었습니다!');
        } else {
            console.log('⚠️ 로그인 버튼을 찾을 수 없습니다. 수동으로 확인해주세요.');
        }
        
        console.log('✅ IROS 사이트 접속 완료. 로그인해주세요...');
    }

    async waitForLogin() {
        console.log('🔑 IROS 사이트에 로그인해주세요...');
        console.log('💡 브라우저에서 로그인을 완료한 후 아래 메시지에 "완료" 또는 "y"를 입력하세요.');
        console.log('⚠️  주의: 로그인을 완료하지 않고 진행하면 오류가 발생할 수 있습니다.');
        
        while (true) {
            const answer = await this.askQuestion('\n🔐 로그인이 완료되었나요? (완료/y/yes): ');
            
            if (answer.toLowerCase() === '완료' || 
                answer.toLowerCase() === 'y' || 
                answer.toLowerCase() === 'yes') {
                console.log('✅ 로그인 완료 확인! 자동화를 시작합니다...');
                break;
            } else {
                console.log('⏳ 로그인을 완료한 후 다시 입력해주세요...');
            }
        }
    }

    async removeAdsAndPopups() {
        console.log('🧹 광고/배너/팝업 제거 중...');
        
        const removedCount = await this.page.evaluate(() => {
            let count = 0;
            
            // 일반적인 광고/팝업 선택자들
            const selectors = [
                '[class*="banner"]', '[id*="banner"]',
                '[class*="popup"]', '[id*="popup"]', 
                '[class*="modal"]', '[id*="modal"]',
                '[class*="overlay"]', '[id*="overlay"]',
                '[class*="layer"]', '[id*="layer"]',
                '.ad', '#ad', '[class*="advertisement"]'
            ];
            
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el.offsetParent !== null) {
                        el.style.display = 'none';
                        count++;
                    }
                });
            });
            
            // 닫기 버튼들 클릭
            const closeButtons = document.querySelectorAll('button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close');
            closeButtons.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.click();
                    count++;
                }
            });
            
            return count;
        });
        
        console.log(`✅ ${removedCount}개의 광고/배너/팝업이 제거되었습니다.`);
    }

    // 🔧 개선된 결제 팝업 처리 메서드
    async handlePaymentPopup() {
        console.log('🧾 결제 팝업 확인...');
        try {
            // 1단계: 팝업 메시지 존재 여부 확인
            const popupExists = await this.page.evaluate(() => {
                const texts = Array.from(document.querySelectorAll('*')).some(el => 
                    el.textContent && el.textContent.includes('결제할 등기사항증명서가 존재합니다')
                );
                return texts;
            });

            if (popupExists) {
                console.log('🎯 결제 팝업 감지! 취소 버튼 클릭 시도...');
                
                // 2단계: 다양한 방법으로 취소 버튼 찾기 및 클릭
                const clickSuccess = await this.page.evaluate(() => {
                    // 방법 1: 텍스트가 "취소"인 모든 요소 찾기
                    const allElements = Array.from(document.querySelectorAll('*'));
                    const cancelElements = allElements.filter(el => 
                        el.textContent && el.textContent.trim() === '취소' && 
                        (el.tagName === 'A' || el.tagName === 'BUTTON' || el.onclick || el.href)
                    );
                    
                    for (let element of cancelElements) {
                        if (element.offsetParent !== null) { // 보이는 요소만
                            try {
                                element.click();
                                console.log('✅ 취소 버튼 클릭 성공 (방법 1):', element);
                                return true;
                            } catch (e) {
                                console.log('⚠️ 클릭 실패:', e);
                            }
                        }
                    }
                    
                    // 방법 2: 링크 태그에서 취소 찾기
                    const links = Array.from(document.querySelectorAll('a'));
                    for (let link of links) {
                        if (link.textContent && link.textContent.includes('취소') && link.offsetParent !== null) {
                            try {
                                link.click();
                                console.log('✅ 취소 링크 클릭 성공 (방법 2):', link);
                                return true;
                            } catch (e) {
                                console.log('⚠️ 링크 클릭 실패:', e);
                            }
                        }
                    }
                    
                    // 방법 3: 버튼 태그에서 취소 찾기
                    const buttons = Array.from(document.querySelectorAll('button'));
                    for (let button of buttons) {
                        if (button.textContent && button.textContent.includes('취소') && button.offsetParent !== null) {
                            try {
                                button.click();
                                console.log('✅ 취소 버튼 클릭 성공 (방법 3):', button);
                                return true;
                            } catch (e) {
                                console.log('⚠️ 버튼 클릭 실패:', e);
                            }
                        }
                    }
                    
                    return false;
                });

                if (clickSuccess) {
                    await this.page.waitForTimeout(1000);
                    console.log('✅ 결제 팝업 "취소" 클릭 완료');
                    return true;
                } else {
                    // 3단계: ESC키로 대체 시도
                    console.log('⚠️ 취소 버튼 클릭 실패, ESC키 시도...');
                    await this.page.keyboard.press('Escape');
                    await this.page.waitForTimeout(500);
                    console.log('✅ ESC키로 팝업 닫기 시도');
                    return true;
                }
            } else {
                console.log('ℹ️ 결제 팝업이 감지되지 않았습니다.');
                return false;
            }
        } catch (e) {
            console.log('⚠️ 결제 팝업 처리 중 예외:', e.message);
            return false;
        }
    }

    // 🔧 개선된 법인 검색 페이지 이동 메서드
    async navigateToSearch() {
        console.log('🔍 법인 검색 페이지로 이동 중...');
        
        // 1단계: 먼저 결제 팝업 처리
        await this.handlePaymentPopup();
        
        // 🎯 MCP 스타일 JSON API 명령 - 법인 열람·발급 버튼 클릭
        const navigationCommand = {
            "element": "법인 열람·발급",
            "ref": "e628" // MCP에서 성공한 정확한 ref 사용
        };
        
        console.log('🏢 법인 열람·발급 버튼 클릭 명령 실행:', JSON.stringify(navigationCommand, null, 2));
        
        // 2단계: MCP에서 성공한 방식으로 법인 열람·발급 버튼 클릭
        let clickResult = false;
        
        // 방법 1: MCP에서 성공한 방식 - getByRole 사용
        try {
            await this.page.getByRole('link', { name: '법인 열람·발급' }).click();
            clickResult = true;
            console.log('✅ 법인 열람·발급 버튼 클릭 성공 (MCP 방법 1 - getByRole)');
        } catch (e1) {
            console.log('⚠️ MCP 방법 1 실패, JavaScript 방법 시도...');
            
            // 방법 2: JavaScript evaluate로 직접 찾기 (기존 방식 개선)
            try {
                clickResult = await this.page.evaluate(() => {
                    // 더 정확한 텍스트 매칭
                    const links = Array.from(document.querySelectorAll('a'));
                    console.log(`발견된 링크 수: ${links.length}`);
                    
                    // 우선순위 1: 정확한 텍스트 "법인 열람·발급"
                    let corporationLink = links.find(link => 
                        link.textContent && link.textContent.trim() === '법인 열람·발급'
                    );
                    
                    // 우선순위 2: 부분 텍스트 포함
                    if (!corporationLink) {
                        corporationLink = links.find(link => 
                            link.textContent && link.textContent.includes('법인 열람·발급')
                        );
                    }
                    
                    // 우선순위 3: 더 넓은 범위의 법인 관련 링크
                    if (!corporationLink) {
                        corporationLink = links.find(link => 
                            link.textContent && (
                                link.textContent.includes('법인') || 
                                link.textContent.includes('열람') ||
                                link.textContent.includes('발급')
                            )
                        );
                    }
                    
                    if (corporationLink) {
                        console.log('법인 열람·발급 버튼 발견:', corporationLink.textContent);
                        corporationLink.click();
                        return true;
                    }
                    
                    console.log('법인 열람·발급 버튼을 찾을 수 없습니다.');
                    return false;
                });
                
                if (clickResult) {
                    console.log('✅ 법인 열람·발급 버튼 클릭 성공 (MCP 방법 2 - JavaScript)');
                }
            } catch (e2) {
                console.log('❌ JavaScript 방법도 실패:', e2.message);
            }
        }

        if (!clickResult) {
            console.log('⚠️ 법인 열람·발급 버튼을 찾을 수 없습니다.');
            throw new Error('법인 열람·발급 버튼 클릭 실패');
        }
        
        // 3단계: 개선된 로딩 대기 방식
        console.log('⏳ 페이지 로딩 대기 중...');
        try {
            // 먼저 짧은 시간으로 networkidle 시도
            await this.page.waitForLoadState('networkidle', { timeout: 8000 });
            console.log('✅ networkidle 완료');
        } catch (e) {
            console.log('⚠️ networkidle 타임아웃, domcontentloaded로 대체...');
            try {
                await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
                console.log('✅ domcontentloaded 완료');
            } catch (e2) {
                console.log('⚠️ 로딩 상태 대기 실패, 고정 시간 대기...');
            }
        }
        
        console.log('✅ 법인 검색 페이지 도달');
        
        // 4단계: 페이지가 완전히 로드되고 결제 팝업이 나타날 시간 확보
        console.log('⏳ 법인 검색 페이지 완전 로딩 대기 중... (3초)');
        await this.page.waitForTimeout(3000);
        
        // 5단계: 페이지 로딩 완료 후 결제 팝업 확인 및 처리
        console.log('🔍 페이지 로딩 완료 후 결제 팝업 확인...');
        await this.handlePaymentPopup();
    }

    async navigateToHome() {
        console.log('🏠 홈화면으로 이동 중...');
        
        try {
            // 홈 버튼이 나타날 때까지 대기
            await this.page.waitForSelector('#mf_wfm_potal_main_wf_header_btn_home', { timeout: 10000 });
            
            // 홈 버튼 클릭
            await this.page.click('#mf_wfm_potal_main_wf_header_btn_home');
            console.log('✅ 홈 버튼 클릭 성공');
            
            // 페이지 로딩 대기
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(2000);
            
            console.log('✅ 홈화면 도달 완료');
            
        } catch (e) {
            console.log('⚠️ 홈 버튼 클릭 실패, URL로 직접 이동...');
            // 대안: URL로 직접 이동
            await this.page.goto('https://www.iros.go.kr/index.jsp', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(2000);
            console.log('✅ 홈화면 도달 완료 (URL 직접 이동)');
        }
    }

    // 각 회사별로 다른 검색 필터 설정
    async setupSearchFiltersForCompany(companyData) {
        console.log(`⚙️ "${companyData.등기상호}" 검색 필터 설정 중...`);
        
        try {
            // 1. 등기소 설정 (CSV에서 읽은 값 또는 기본값 사용)
            await this.page.getByLabel('등기소').selectOption({ label: companyData.등기소 });
            console.log(`✅ 등기소: ${companyData.등기소}`);
            
            // 2. 법인구분 설정 (CSV에서 읽은 값 또는 기본값 사용)
            await this.page.getByLabel('법인구분').selectOption({ label: companyData.법인구분 });
            console.log(`✅ 법인구분: ${companyData.법인구분}`);
            
            // 3. 등기부상태 설정 (CSV에서 읽은 값 또는 기본값 사용)
            await this.page.getByLabel('등기부상태').selectOption({ label: companyData.등기부상태 });
            console.log(`✅ 등기부상태: ${companyData.등기부상태}`);
            
            // 4. 본지점구분 설정 (CSV에서 읽은 값 또는 기본값 사용)
            if (companyData.본지점구분 !== '전체 본지점') {
                await this.page.getByLabel('본지점구분').selectOption({ label: companyData.본지점구분 });
                console.log(`✅ 본지점구분: ${companyData.본지점구분}`);
            } else {
                console.log('✅ 본지점구분: 전체 본지점 (기본값 유지)');
            }
            
            console.log(`✅ "${companyData.등기상호}" 검색 필터 설정 완료`);
            await this.page.waitForTimeout(500);
            
        } catch (error) {
            console.log(`⚠️ "${companyData.등기상호}" 검색 필터 설정 중 오류:`, error.message);
        }
    }

    // 기존 메서드 유지 (하위 호환성)
    async setupSearchFilters() {
        console.log('⚙️ 검색 필터 설정 중... (기본값 사용)');
        
        try {
            await this.page.getByLabel('등기소').selectOption({ label: '전체등기소' });
            await this.page.getByLabel('법인구분').selectOption({ label: '전체 법인(지배인, 미성년자, 법정대리인 제외)' });
            await this.page.getByLabel('등기부상태').selectOption({ label: '살아있는 등기' });
            
            console.log('✅ 기본 검색 필터 설정 완료');
            await this.page.waitForTimeout(500);
            
        } catch (error) {
            console.log('⚠️ 검색 필터 설정 중 오류 발생:', error.message);
        }
    }

    async searchCompany(companyName) {
        console.log(`🔍 "${companyName}" 검색 중...`);
        
        try {
            // 🎯 MCP 스타일 JSON API 명령 - 등기상호 입력 필드에 텍스트 입력
            const inputCommand = {
                "element": "등기상호 입력 필드",
                "ref": "e1258", // MCP에서 성공한 정확한 ref 사용
                "text": companyName
            };
            
            console.log('📝 등기상호 입력 명령 실행:', JSON.stringify(inputCommand, null, 2));
            
            // Playwright 코드로 MCP 명령 구현
            let inputSuccess = false;
            
            // 방법 1: 정확한 ID selector 사용
            try {
                // 사용자가 제공한 정확한 입력 필드 ID
                const inputField = this.page.locator('#mf_wfm_potal_main_wfm_content_sbx_conm___input');
                await inputField.clear(); // 기존 값 클리어
                await inputField.fill(companyName);
                await inputField.press('Tab'); // 입력 완료 확인
                
                inputSuccess = true;
                console.log('✅ 등기상호 입력 성공 (정확한 ID selector)');
            } catch (e1) {
                console.log('⚠️ 정확한 ID selector 실패, JavaScript 직접 입력 시도...');
                
                // 방법 2: JavaScript로 정확한 ID 사용
                try {
                    const jsInputResult = await this.page.evaluate((companyName) => {
                        // 사용자가 제공한 정확한 ID로 입력 필드 찾기
                        let targetInput = document.getElementById('mf_wfm_potal_main_wfm_content_sbx_conm___input');
                        
                        if (!targetInput) {
                            console.log('정확한 ID로 찾지 못함, 대안 방법 시도...');
                            // 대안 1: querySelector로 시도
                            targetInput = document.querySelector('#mf_wfm_potal_main_wfm_content_sbx_conm___input');
                        }
                        
                        if (!targetInput) {
                            console.log('querySelector도 실패, 일반적인 방법 시도...');
                            // 대안 2: 상호명 관련 필드 찾기
                            const textInputs = document.querySelectorAll('input[type="text"]');
                            for (const input of textInputs) {
                                if ((input.placeholder && input.placeholder.includes('상호')) ||
                                    (input.name && input.name.includes('compNm')) ||
                                    (input.id && input.id.includes('conm'))) {
                                    targetInput = input;
                                    console.log('대안으로 등기상호 입력 필드 발견:', input);
                                    break;
                                }
                            }
                        }
                        
                        if (targetInput) {
                            // MCP에서 성공한 입력 방식 재현
                            targetInput.value = '';
                            targetInput.value = companyName;
                            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                            targetInput.focus();
                            console.log(`입력 완료: "${companyName}"`);
                            return { success: true, value: targetInput.value };
                        }
                        
                        return { success: false, error: '등기상호 입력 필드를 찾을 수 없습니다' };
                    }, companyName);
                    
                    if (jsInputResult.success) {
                        inputSuccess = true;
                        console.log('✅ 등기상호 입력 성공 (MCP 스타일 방법 2 - JavaScript)');
                        console.log('✅ 입력된 값:', jsInputResult.value);
                    } else {
                        console.log('❌ JavaScript 입력 실패:', jsInputResult.error);
                    }
                } catch (e2) {
                    console.log('❌ JavaScript 입력 중 예외:', e2.message);
                }
            }
            
            if (!inputSuccess) {
                throw new Error('등기상호 입력 필드를 찾을 수 없습니다');
            }
            
            await this.page.waitForTimeout(1000);
            
            // 🎯 MCP 스타일 JSON API 명령 - 검색 버튼 클릭
            const searchCommand = {
                "element": "검색 버튼",
                "ref": "e1261" // MCP에서 성공한 정확한 ref 사용
            };
            
            console.log('🔍 검색 버튼 클릭 명령 실행:', JSON.stringify(searchCommand, null, 2));
            
            // Playwright 코드로 MCP 검색 명령 구현
            try {
                // 사용자가 제공한 정확한 검색 버튼 ID 사용 (요소가 준비될 때까지 대기)
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_conm_search', { timeout: 10000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_conm_search');
                console.log('✅ 검색 버튼 클릭 성공 (정확한 ID selector)');
            } catch (e) {
                console.log('⚠️ 정확한 ID selector 실패:', e.message);
                console.log('⚠️ 정확한 ID selector 실패, MCP 방법 시도...');
                try {
                    // 대안 1: MCP에서 성공한 방식
                    await this.page.getByRole('link', { name: '검색' }).click();
                    console.log('✅ 검색 버튼 클릭 성공 (MCP getByRole)');
                } catch (e2) {
                    console.log('⚠️ getByRole도 실패, 일반적인 방법 시도...');
                    // 대안 2: 더 광범위한 검색 버튼 selector
                    await this.page.click('a:has-text("검색"), button:has-text("검색"), input[value="검색"], [onclick*="search"]');
                    console.log('✅ 검색 버튼 클릭 성공 (일반적인 방법)');
                }
            }
            
            // MCP에서 성공한 로딩 대기 방식
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(3000);
            
            console.log(`✅ "${companyName}" 검색 완료 (MCP 스타일)`);
            
        } catch (error) {
            console.log(`❌ "${companyName}" 검색 실패:`, error.message);
            console.log(`⏭️ "${companyName}" 건너뛰고 다음 회사로 진행합니다.`);
            throw error; // 바로 에러를 던져서 다음 회사로 넘어가도록 함
        }
    }

    async selectCompanyAndProceed() {
        console.log('📋 검색 결과에서 첫 번째 회사 선택...');
        
        // 1단계: 먼저 다음 버튼 클릭 시도 (정상적인 경우)
        try {
            // 사용자가 제공한 정확한 다음 버튼 ID 사용
            await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
            console.log('✅ 다음 버튼 클릭 성공 (정확한 ID selector)');
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            console.log('✅ 회사 선택 및 진행 완료');
            return true; // 성공
        } catch (e) {
            console.log('⚠️ 정확한 ID로 다음 버튼 클릭 실패, 대안 방법 시도...');
            try {
                // 대안: 일반적인 다음 버튼 selector
                await this.page.click('link:has-text("다음")');
                console.log('✅ 다음 버튼 클릭 성공 (일반적인 방법)');
                await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(2000);
                console.log('✅ 회사 선택 및 진행 완료');
                return true; // 성공
            } catch (e2) {
                console.log('⚠️ 모든 다음 버튼 클릭 방법 실패, 검색 결과 확인 중...');
                
                // 2단계: 다음 버튼 클릭이 모두 실패했을 때만 검색 결과 확인
                console.log('🔍 검색 결과 존재 여부 확인 중...');
                const hasNoResults = await this.checkForNoSearchResults();
                
                if (hasNoResults) {
                    console.log('❌ 검색 결과가 없음 - 상호명이 존재하지 않는 것으로 간주');
                    console.log('🔄 홈페이지로 돌아가서 다음 회사로 건너뛰기...');
                    
                    // 홈페이지로 돌아가기
                    await this.navigateToHome();
                    
                    // 검색 페이지로 다시 이동
                    await this.navigateToSearch();
                    
                    throw new Error('상호명이 존재하지 않거나 검색 결과가 없음');
                } else {
                    console.log('❌ 다음 버튼이 없지만 검색 결과는 존재함 - 기타 오류로 간주');
                    throw new Error('다음 버튼 클릭 실패 - 기타 오류');
                }
            }
        }
    }

    // 검색 결과가 없는지 확인하는 메서드
    async checkForNoSearchResults() {
        try {
            // 방법 1: 특정 XPath로 "검색조건에 맞는 법인등기기록을 찾지 못했습니다" 텍스트 확인
            const noResultsElement = await this.page.$('//*[@id="mf_wfm_potal_main_wfm_content_wq_uuid_4536"]/b/span');
            if (noResultsElement) {
                const text = await noResultsElement.textContent();
                if (text && text.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                    console.log('✅ 검색 결과 없음 메시지 감지됨:', text);
                    return true;
                }
            }
            
            // 방법 2: 페이지 전체에서 해당 텍스트 검색
            const pageContent = await this.page.content();
            if (pageContent.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                console.log('✅ 검색 결과 없음 메시지 감지됨 (페이지 전체 검색)');
                return true;
            }
            
            // 방법 3: JavaScript로 직접 확인
            const hasNoResults = await this.page.evaluate(() => {
                // 특정 XPath 요소 확인
                const xpathElement = document.evaluate(
                    '//*[@id="mf_wfm_potal_main_wfm_content_wq_uuid_4536"]/b/span',
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;
                
                if (xpathElement && xpathElement.textContent.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                    return true;
                }
                
                // 전체 페이지에서 텍스트 검색
                const allElements = Array.from(document.querySelectorAll('*'));
                return allElements.some(el => 
                    el.textContent && el.textContent.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')
                );
            });
            
            if (hasNoResults) {
                console.log('✅ 검색 결과 없음 메시지 감지됨 (JavaScript 검색)');
                return true;
            }
            
            console.log('ℹ️ 검색 결과가 존재함');
            return false;
            
        } catch (error) {
            console.log('⚠️ 검색 결과 확인 중 오류:', error.message);
            return false; // 오류 시에는 검색 결과가 있다고 가정
        }
    }

    async setIssuanceOptions() {
        console.log('📄 발급 옵션 설정 중... (열람 선택)');
        
        try {
            // 🔧 1단계: 강화된 로딩 대기 (트래픽 고려)
            console.log('⏳ 페이지 완전 로딩 대기 중... (트래픽 고려)');
            await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 });
            await this.page.waitForTimeout(3000); // 추가 대기
            
            // 🔧 2단계: 열람 라디오 버튼이 나타날 때까지 대기 (최대 30초)
            console.log('🔍 열람 라디오 버튼 대기 중...');
            await this.page.waitForSelector('input[type="radio"][data-index="0"]', { 
                timeout: 30000,
                state: 'visible'
            });
            
            // 🔧 3단계: 추가 안정화 대기
            await this.page.waitForTimeout(2000);
            
            // 🔧 4단계: 열람 라디오 버튼 선택 (강화된 방식)
            console.log('✅ 열람 라디오 버튼 발견! 선택 중...');
            const result = await this.page.evaluate(() => {
                const viewRadio = document.querySelector('input[type="radio"][data-index="0"]');
                if (viewRadio && viewRadio.offsetParent !== null) { // 보이는 요소인지 확인
                    viewRadio.click();
                    console.log('✅ 열람 옵션 선택 성공');
                    return "✅ 열람 옵션이 성공적으로 선택되었습니다.";
                }
                return "❌ 열람 라디오 버튼을 찾을 수 없거나 보이지 않습니다.";
            });
            console.log('JavaScript 실행 결과:', result);
            
            // 🔧 5단계: 선택 후 안정화 대기
            await this.page.waitForTimeout(1500);
            
            // 🔧 6단계: 다음 버튼 클릭 (강화된 대기)
            console.log('🔍 다음 버튼 대기 중...');
            try {
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_next', { 
                    timeout: 20000,
                    state: 'visible'
                });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
                console.log('✅ 다음 버튼 클릭 성공 (정확한 ID)');
            } catch (e) {
                console.log('⚠️ 정확한 ID 실패, 대안 방법 시도...');
                // 대안: 더 넓은 범위의 다음 버튼 찾기
                await this.page.waitForSelector('a:has-text("다음"), button:has-text("다음")', { timeout: 10000 });
                await this.page.click('a:has-text("다음"), button:has-text("다음")');
                console.log('✅ 다음 버튼 클릭 성공 (대안 방법)');
            }
            
            // 🔧 7단계: 페이지 전환 대기 (트래픽 고려)
            console.log('⏳ 페이지 전환 대기 중... (트래픽 고려)');
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
            await this.page.waitForTimeout(3000); // 추가 안정화 대기
            
            console.log('✅ 발급 옵션 설정 완료 (열람 선택)');
            
        } catch (error) {
            console.log('⚠️ 발급 옵션 설정 중 오류:', error.message);
            
            // 🔧 재시도 로직
            console.log('🔄 재시도 중...');
            await this.page.waitForTimeout(5000);
            
            try {
                // 간단한 재시도
                await this.page.evaluate(() => {
                    const radios = document.querySelectorAll('input[type="radio"]');
                    if (radios.length > 0) {
                        radios[0].click(); // 첫 번째 라디오 버튼 클릭
                        console.log('재시도: 첫 번째 라디오 버튼 클릭');
                    }
                });
                
                await this.page.waitForTimeout(2000);
                await this.page.click('a:has-text("다음"), button:has-text("다음")');
                console.log('✅ 재시도 성공');
                
            } catch (retryError) {
                console.log('❌ 재시도도 실패:', retryError.message);
                throw new Error('발급 옵션 설정 실패 - 트래픽으로 인한 로딩 지연');
            }
        }
    }

    
    async selectRegistryItems(){
        console.log('📝 등기 항목 선택 중...');
    
        // ✨ 수정된 부분: .first()를 추가하여 여러 요소 중 첫 번째 체크박스만 기다립니다.
        await this.page.locator('input[type="checkbox"][data-rowindex="14"]').first().waitFor();
    
        // evaluate 안의 querySelector는 자동으로 첫 번째 요소를 찾으므로 수정할 필요가 없습니다.
        const result = await this.page.evaluate((registryItems) => {
            let checkedCount = 0;
            registryItems.forEach(rowIndex => {
                const checkbox = document.querySelector(`input[type="checkbox"][data-rowindex="${rowIndex}"]`);
                if (checkbox && !checkbox.checked) checkbox.click();
                checkedCount++;
            });
            return `${checkedCount}개의 체크박스 선택 완료`;
        }, CONFIG.REGISTRY_ITEMS);
        console.log(`✅ ${result}`);
        
        // '다음' 버튼을 클릭합니다.
        await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
        console.log('✅ 다음 버튼 클릭됨');
    
        // 로딩창이 사라질 때까지 기다립니다.
        const loadingFrame = this.page.locator('#__processbarIFrame');
        await loadingFrame.waitFor({ state: 'hidden', timeout: 20000 });
        console.log('✅ 로딩창 사라짐 확인');
    
        console.log('✅ 등기 항목 선택 완료');
    }
// ▲▲▲▲▲ [끝] 여기까지 교체 ▲▲▲▲▲

    async setPrivacyOption(){
        console.log('🔒 주민등록번호 공개여부 설정 중...');
        
        try {
            // 현재 페이지 상태 확인
            console.log('🔍 현재 페이지 상태 확인 중...');
            const currentUrl = this.page.url();
            const pageTitle = await this.page.title();
            console.log('현재 URL:', currentUrl);
            console.log('현재 페이지 제목:', pageTitle);
            
            // 먼저 중복결제 확인이 있는지 체크
            console.log('🔍 중복결제 확인 중...');
            const hasDuplicate = await this.checkForDuplicatePayment();
            
            if (hasDuplicate) {
                console.log('✅ 중복결제 감지됨 - 중복결제 처리 시작');
                await this.handleDuplicatePaymentConfirmation();
                throw new Error('중복결제 - 등기상호검색 페이지로 이동됨');
            }
            
            // 중복결제가 없으면 미공개 라디오 버튼 처리
            console.log('🔍 "미공개" 라디오 버튼 처리 중...');
            await this.waitForPrivateRadioAndProcess();
            
            console.log('✅ 주민등록번호 공개여부 설정 완료');
            
        } catch (error) {
            console.error('❌ 처리 중 오류 발생:', error.message);
            
            // 중복결제 에러인 경우 특별 처리
            if (error.message.includes('중복결제')) {
                console.log('🔄 중복결제로 인해 등기상호검색 페이지로 이동됨');
                throw error; // 중복결제 에러는 그대로 전달
            }
            
            // 다른 에러인 경우 현재 페이지 상태 확인
            console.log('🔍 에러 발생 시 페이지 상태 확인 중...');
            const currentUrl = this.page.url();
            const pageTitle = await this.page.title();
            console.log('현재 URL:', currentUrl);
            console.log('현재 페이지 제목:', pageTitle);
            
            // 페이지 내용도 확인
            const pageContent = await this.page.content();
            console.log('현재 페이지 내용 일부:', pageContent.substring(0, 1000));
            
            throw error;
        }
    }
    
    // 중복결제 확인 함수 (간단한 체크)
    async checkForDuplicatePayment() {
        try {
            // 방법 1: 특정 ID로 감지
            const duplicateElement = await this.page.$('#mf_wfm_potal_main_wfm_content_wq_uuid_14688');
            if (duplicateElement) {
                console.log('✅ 중복결제 ID 감지됨');
                return true;
            }
            
            // 방법 2: 텍스트로 감지
            const pageContent = await this.page.content();
            if (pageContent.includes('일괄결제대상에 이미 입력된 등기기록입니다') || 
                pageContent.includes('일괄결제대상에 이미 입력된')) {
                console.log('✅ 중복결제 텍스트 감지됨');
                return true;
            }
            
            console.log('ℹ️ 중복결제 없음 - 정상 진행');
            return false;
            
        } catch (error) {
            console.log('ℹ️ 중복결제 확인 중 오류:', error.message);
            return false;
        }
    }
    
    // A: 미공개 라디오 버튼 처리
    async waitForPrivateRadioAndProcess() {
        console.log('🔍 "미공개" 라디오 버튼 대기 중...');
        
        try {
            const privateRadio = this.page.getByRole('radio', { name: '미공개' });
            await privateRadio.waitFor({ timeout: 10000 });
            
            console.log('✅ "미공개" 라디오 버튼 감지됨 - 미공개 처리 시작');
            
            // 미공개 라디오 버튼 체크
            await privateRadio.check();
            console.log('✅ "미공개" 라디오 버튼 클릭 완료');
            
            // 체크 검증
            if (await privateRadio.isChecked()) {
                console.log('✅ "미공개" 라디오 버튼이 성공적으로 체크되었습니다.');
            } else {
                throw new Error('"미공개" 라디오 버튼을 체크하는데 실패했습니다.');
            }

            // 다음 버튼 클릭
            console.log('🔍 다음 버튼 클릭 중...');
            await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
            console.log('✅ 다음 버튼 클릭됨. 로딩창이 사라지기를 기다립니다...');
        
            // 로딩창이 사라질 때까지 기다립니다.
            const loadingFrame = this.page.locator('#__processbarIFrame');
            await loadingFrame.waitFor({ state: 'hidden', timeout: 20000 });
            console.log('✅ 로딩창 사라짐 확인');
        
            // 다음 페이지의 '다음' 버튼이 나타날 때까지 기다립니다.
            console.log('🔍 다음 페이지의 다음 버튼 대기 중...');
            await this.page.locator('#mf_wfm_potal_main_wfm_content_btn_next').waitFor();
            console.log('✅ 다음 페이지의 다음 버튼 감지됨');
            
            return '미공개 처리 완료';
            
        } catch (error) {
            console.error('❌ 미공개 라디오 버튼 처리 중 오류:', error.message);
            
            // 현재 페이지 상태 확인
            const currentUrl = this.page.url();
            const pageTitle = await this.page.title();
            console.log('현재 URL:', currentUrl);
            console.log('현재 페이지 제목:', pageTitle);
            
            throw error;
        }
    }
    

    // 중복결제 확인 처리 함수
    async handleDuplicatePaymentConfirmation() {
        console.log('🔄 중복결제 처리 중...');
        
        try {
            // "처음으로" 버튼 클릭
            try {
                // 먼저 정확한 ID로 시도
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_first', { timeout: 3000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_first');
                console.log('✅ 처음으로 버튼 클릭 성공 (정확한 ID)');
            } catch (e) {
                console.log('⚠️ 정확한 ID로 처음으로 버튼 클릭 실패, 텍스트 방식으로 시도...');
                try {
                    // 텍스트로 찾기
                    await this.page.click('link:has-text("처음으로")');
                    console.log('✅ 처음으로 버튼 클릭 성공 (텍스트 방식)');
                } catch (e2) {
                    console.log('⚠️ 텍스트 방식도 실패, JavaScript로 직접 클릭...');
                    // JavaScript로 직접 클릭
                    await this.page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('a'));
                        const firstButton = buttons.find(btn => btn.textContent.includes('처음으로'));
                        if (firstButton) {
                            firstButton.click();
                            return '처음으로 버튼 클릭 성공 (JavaScript)';
                        }
                        return '처음으로 버튼을 찾을 수 없음';
                    });
                    console.log('✅ 처음으로 버튼 클릭 성공 (JavaScript)');
                }
            }
            
            // 페이지 로딩 대기
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            
            // "처음으로" 버튼을 누르면 자동으로 검색 페이지로 이동됨
            // setupSearchFilters는 다음 회사 처리 시 자동으로 호출됨
            
            console.log('✅ 중복결제 처리 완료 - 자동으로 검색 페이지로 이동됨');
            return true; // 중복결제 처리가 완료되었음을 반환
            
        } catch (e) {
            console.log('ℹ️ 중복결제 처리 중 오류:', e.message);
            return false;
        }
    }

    async finalConfirmation(isLastInBatch = false, isLastBatch = false) {
        console.log('🎯 최종 확인 및 결제 페이지 이동...');
        
        // 🎯 등기사항증명서 확인 페이지에서 다음 버튼 클릭
        try {
            await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_next', { timeout: 10000 });
            await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
            console.log('✅ 등기사항증명서 확인 다음 버튼 클릭 성공 (정확한 ID)');
        } catch (e) {
            console.log('⚠️ 정확한 ID 실패, 대안 방법 시도...');
            await this.page.click('link:has-text("다음")');
            console.log('✅ 등기사항증명서 확인 다음 버튼 클릭 성공 (대안 방법)');
        }
        
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        
        // 🎯 결제대상확인 페이지에서 추가 또는 결제 버튼 클릭
        if (isLastInBatch && isLastBatch) {
            // 배치의 마지막 회사이고 전체 마지막 배치인 경우: 결제 버튼 클릭
            try {
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_pay', { timeout: 10000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_pay');
                console.log('✅ 결제 버튼 클릭 성공 (정확한 ID) - 전체 완료!');
            } catch (e) {
                console.log('⚠️ 정확한 결제 버튼 ID 실패, 대안 방법 시도...');
                await this.page.click('link:has-text("결제")');
                console.log('✅ 결제 버튼 클릭 성공 (대안 방법)');
            }
        } else if (isLastInBatch && !isLastBatch) {
            // 배치의 마지막 회사이지만 전체 마지막 배치가 아닌 경우: 아무 버튼도 누르지 않음
            console.log('✅ 배치 완료 - 추가 버튼을 누르지 않고 결제 대기 상태로 유지');
        } else {
            // 배치 중간 회사인 경우: 추가 버튼 클릭
            try {
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_new_add', { timeout: 10000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_new_add');
                console.log('✅ 추가 버튼 클릭 성공 (정확한 ID)');
            } catch (e) {
                console.log('⚠️ 정확한 추가 버튼 ID 실패, 대안 방법 시도...');
                await this.page.click('link:has-text("추가")');
                console.log('✅ 추가 버튼 클릭 성공 (대안 방법)');
            }
        }
        
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(3000);
        
        console.log('✅ 결제 페이지 도달 완료');
    }

    async processCompany(companyData, isFirst = true, isLastInBatch = false, isLastBatch = false) {
        const companyName = companyData.등기상호;
        console.log(`\n🏢 ===== "${companyName}" 처리 시작 =====`);
        
        try {
            // 🎯 각 회사마다 CSV에서 읽은 실제 검색 조건 적용
            console.log(`⚙️ "${companyName}" 처리 전 검색 필터 설정...`);
            await this.setupSearchFiltersForCompany(companyData);

            // 🎯 모든 회사마다 동일한 방식으로 처리
            console.log(`🔍 "${companyName}" 검색 시작...`);
            await this.searchCompany(companyName);
            await this.selectCompanyAndProceed();
            await this.setIssuanceOptions();
            await this.selectRegistryItems();
            await this.setPrivacyOption();
            await this.finalConfirmation(isLastInBatch, isLastBatch);
            
            this.processedCompanies.push(companyName);
            console.log(`✅ "${companyName}" 처리 완료 - 결제 페이지 도달`);
            return true;
            
        } catch (error) {
            console.error(`❌ "${companyName}" 처리 실패: ${error.message}`);
            
            // 상호명이 존재하지 않는 경우와 다른 오류를 구분
            if (error.message.includes('상호명이 존재하지 않거나 검색 결과가 없음')) {
                console.log(`⏭️ "${companyName}" - 상호명이 존재하지 않음, 건너뛰고 다음 회사로 진행`);
                this.failedCompanies.push({ company: companyName, error: '상호명이 존재하지 않음' });
            } else {
                console.log(`⏭️ "${companyName}" - 기타 오류로 건너뛰고 다음 회사로 진행`);
                this.failedCompanies.push({ company: companyName, error: error.message });
                
                // 기타 오류인 경우에만 검색 필터 재설정
                try {
                    await this.setupSearchFilters();
                } catch (filterError) {
                    console.log('⚠️ 검색 필터 재설정 실패, 기본값으로 계속 진행');
                }
            }
            
            return false; // 실패했지만 다음 회사로 진행
        }
    }

    async processMultipleCompanies(companies, batchSize = 10) {
        console.log(`\n📊 총 ${companies.length}개 회사 처리 시작 (배치 크기: ${batchSize})`);
        
        for (let i = 0; i < companies.length; i += batchSize) {
            const batch = companies.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(companies.length / batchSize);
            
            console.log(`\n🎯 배치 ${batchNumber}/${totalBatches} 처리 중 (${batch.length}개 회사)`);
            console.log(`회사 목록: ${batch.join(', ')}`);
            
            try {
                // 배치 내의 회사들 순차 처리
                let successCount = 0;
                let failCount = 0;
                
                for (let j = 0; j < batch.length; j++) {
                    const companyData = batch[j];
                    const isFirst = (i === 0 && j === 0); // 전체 첫 번째 회사인지 확인
                    const isLastInBatch = (j === batch.length - 1); // 배치 내 마지막 회사인지 확인
                    const isLastBatch = (batchNumber === totalBatches); // 마지막 배치인지 확인
                    
                    const result = await this.processCompany(companyData, isFirst, isLastInBatch, isLastBatch);
                    
                    if (result === true) {
                        successCount++;
                        console.log(`✅ "${companyData.등기상호}" 성공 (${successCount}/${batch.length})`);
                    } else {
                        failCount++;
                        console.log(`⏭️ "${companyData.등기상호}" 건너뛰기 (중복결제 또는 기타 사유)`);
                    }
                }
                
                console.log(`\n📊 배치 ${batchNumber} 결과: 성공 ${successCount}개, 실패 ${failCount}개`);
                
                // 배치 완료 후 사용자에게 결제 요청
                if (successCount > 0) {
                    console.log(`\n🎉 배치 ${batchNumber} 완료! ${successCount}개 회사가 결제 페이지에 추가되었습니다.`);
                    console.log('💳 이제 결제를 진행해주세요.');
                } else {
                    console.log(`\n⚠️ 배치 ${batchNumber} 완료! 성공한 회사가 없습니다.`);
                    console.log('💡 다음 배치로 진행합니다.');
                }
                
                // 마지막 배치가 아니고 성공한 회사가 있는 경우에만 결제 완료 대기
                if (i + batchSize < companies.length && successCount > 0) {
                    console.log('\n⏳ 결제 완료 후 다음 배치를 진행합니다...');
                    const answer = await this.askQuestion('결제가 완료되었나요? (완료/y/yes): ');
                    
                    if (answer.toLowerCase() === '완료' || 
                        answer.toLowerCase() === 'y' || 
                        answer.toLowerCase() === 'yes') {
                        console.log('✅ 결제 완료 확인! 다음 배치를 시작합니다...');
                        
                        // 홈화면으로 이동
                        await this.navigateToHome();
                        
                        // 다음 배치를 위해 검색 페이지로 이동
                        await this.navigateToSearch();
                        await this.setupSearchFilters();
                    } else {
                        console.log('❌ 결제가 완료되지 않았습니다. 작업을 중단합니다.');
                        break;
                    }
                } else if (i + batchSize < companies.length && successCount === 0) {
                    // 성공한 회사가 없으면 바로 다음 배치로 진행
                    console.log('\n⏭️ 성공한 회사가 없어 바로 다음 배치로 진행합니다...');
                    await this.navigateToHome();
                    await this.navigateToSearch();
                    await this.setupSearchFilters();
                }
                
            } catch (error) {
                console.error(`❌ 배치 ${batchNumber} 처리 중 오류 발생:`, error.message);
                break;
            }
        }
    }

    async automateFromCSV(csvPath = './train_data.csv') {
        try {
            console.log('📂 CSV 파일에서 회사 목록 읽기...');
            
            if (!fs.existsSync(csvPath)) {
                throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
            }
            
            // CSV 데이터를 구조화된 형태로 파싱
            const companies = await this.parseCSVData(csvPath);
            
            if (companies.length === 0) {
                throw new Error('CSV 파일에서 유효한 회사명을 찾을 수 없습니다.');
            }
            
            console.log(`📊 CSV에서 ${companies.length}개 회사 발견:`);
            companies.forEach((company, index) => {
                console.log(`  ${index + 1}. ${company.등기상호}`);
                console.log(`     - 등기소: ${company.등기소 || '전체등기소'}`);
                console.log(`     - 법인구분: ${company.법인구분 || '전체 법인(지배인, 미성년자, 법정대리인 제외)'}`);
                console.log(`     - 등기부상태: ${company.등기부상태 || '살아있는 등기'}`);
                console.log(`     - 본지점구분: ${company.본지점구분 || '전체 본지점'}`);
                console.log(`     - 주말여부: ${company.주말여부 || 'N'}`);
                console.log('');
            });
            
            // 10개씩 나눠서 처리할 배치 개수 계산
            const batchSize = CONFIG.BATCH_SIZE;
            const totalBatches = Math.ceil(companies.length / batchSize);
            console.log(`\n🔢 처리 방식: 10개씩 나눠서 ${totalBatches}개 배치로 처리`);
            
            if (totalBatches > 1) {
                console.log(`📋 배치 구성:`);
                for (let i = 0; i < companies.length; i += batchSize) {
                    const batchNumber = Math.floor(i / batchSize) + 1;
                    const batchEnd = Math.min(i + batchSize, companies.length);
                    const batchCount = batchEnd - i;
                    console.log(`  - 배치 ${batchNumber}: ${batchCount}개 회사 (${companies.slice(i, batchEnd).join(', ')})`);
                }
                console.log('\n💡 각 배치 완료 후 결제하고 다음 배치로 진행합니다.');
            }
            
            // 🎯 브라우저 초기화 및 로그인 과정 추가
            console.log('\n🚀 브라우저 초기화 및 로그인 과정 시작...');
            await this.start();
            await this.waitForLogin();
            
            // 🎯 배치 구성 완료 후 법인열람발급 페이지로 이동
            console.log('\n🚀 법인열람발급 페이지로 이동 중...');
            await this.removeAdsAndPopups();
            await this.navigateToSearch();
            
            await this.processMultipleCompanies(companies);
            
        } catch (error) {
            console.error('❌ CSV 자동화 실행 중 오류:', error.message);
            return false;
        }
        
        // 모든 배치 처리 완료 후 사용자에게 완료 알림
        console.log('\n🎉 모든 배치 처리 완료!');
        console.log('💡 브라우저를 닫으면 프로그램이 자동으로 종료됩니다.');
        console.log('💡 또는 터미널에서 Enter를 눌러 프로그램을 종료할 수 있습니다.');
        
        // 사용자가 수동으로 종료할 때까지 대기 (브라우저 닫기로도 종료 가능)
        await this.askQuestion('모든 작업이 완료되었습니다. Enter를 눌러 프로그램을 종료하거나 브라우저를 닫으세요...');
        
        return true;
    }

    async automateFromUserInput() {
        try {
            console.log('🚀 IROS 법인등기 자동화 시작...');
            
            await this.start();
            await this.waitForLogin();
            
            // 🎯 로그인 확인 후 바로 회사명 목록 입력 요청
            let companies = [];
            console.log('\n📝 처리할 회사명 목록을 입력해주세요.');
            console.log('💡 여러 회사는 쉼표(,)로 구분하여 입력하세요.');
            console.log('💡 예: 나인바이오웨어, 나노라티스, 비드오리진');
            
            const companyInput = await this.askQuestion('회사명 목록을 입력하세요: ');
            if (!companyInput || !companyInput.trim()) {
                throw new Error('회사명이 입력되지 않았습니다.');
            }
            
            companies = companyInput.split(',').map(name => name.trim()).filter(name => name);
            
            if (companies.length === 0) {
                throw new Error('유효한 회사명이 없습니다.');
            }
            
            console.log(`\n📊 총 ${companies.length}개 회사 처리 예정:`);
            companies.forEach((company, index) => {
                console.log(`  ${index + 1}. ${company}`);
            });
            
            // 10개씩 나눠서 처리할 배치 개수 계산
            const batchSize = CONFIG.BATCH_SIZE;
            const totalBatches = Math.ceil(companies.length / batchSize);
            console.log(`\n🔢 처리 방식: 10개씩 나눠서 ${totalBatches}개 배치로 처리`);
            
            if (totalBatches > 1) {
                console.log(`📋 배치 구성:`);
                for (let i = 0; i < companies.length; i += batchSize) {
                    const batchNumber = Math.floor(i / batchSize) + 1;
                    const batchEnd = Math.min(i + batchSize, companies.length);
                    const batchCount = batchEnd - i;
                    console.log(`  - 배치 ${batchNumber}: ${batchCount}개 회사 (${companies.slice(i, batchEnd).join(', ')})`);
                }
                console.log('\n💡 각 배치 완료 후 결제하고 다음 배치로 진행합니다.');
            }
            
            // 처리 시작 확인
            let proceed = (process.env.IROS_AUTO_CONFIRM_START || '').toLowerCase();
            if (!(['y','yes','1'].includes(proceed))) {
                const confirm = await this.askQuestion('\n처리를 시작하시겠습니까? (y/yes): ');
                proceed = confirm.toLowerCase();
                if (!(['y','yes'].includes(proceed))) {
                    console.log('❌ 사용자가 취소했습니다.');
                    return;
                }
            }
            
            // 🎯 처리 시작 확인 후 법인열람발급 페이지로 이동
            console.log('\n🚀 법인열람발급 페이지로 이동 중...');
            await this.removeAdsAndPopups();
            await this.navigateToSearch();
            
            await this.processMultipleCompanies(companies);
            
        } catch (error) {
            console.error('❌ 자동화 실행 중 오류:', error.message);
        } finally {
            await this.printSummary();
            if (this.rl) {
                this.rl.close();
            }
        }
    }

    async printSummary() {
        console.log('\n📊 ===== 자동화 결과 요약 =====');
        console.log(`✅ 성공한 회사: ${this.processedCompanies.length}개`);
        console.log(`❌ 실패한 회사: ${this.failedCompanies.length}개`);
        
        if (this.processedCompanies.length > 0) {
            console.log('\n✅ 성공한 회사 목록:');
            this.processedCompanies.forEach((company, index) => {
                console.log(`  ${index + 1}. ${company}`);
            });
        }
        
        if (this.failedCompanies.length > 0) {
            console.log('\n❌ 실패한 회사 목록:');
            this.failedCompanies.forEach((item, index) => {
                console.log(`  ${index + 1}. ${item.company} - ${item.error}`);
            });
        }
        
        console.log('\n🎯 자동화 완료!');
    }

    // CSV 데이터를 구조화된 형태로 파싱하는 메서드
    async parseCSVData(csvPath) {
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const lines = csvContent.split('\n').filter(line => line.trim());
        
        const companies = [];
        const headers = lines[0].split(',');
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values[0] && values[0].trim()) { // 등기상호가 있는 경우만
                companies.push({
                    등기상호: values[0].trim(),
                    등기소: values[1] && values[1].trim() ? values[1].trim() : CONFIG.DEFAULT_VALUES.REGISTRY_OFFICE,
                    법인구분: values[2] && values[2].trim() ? values[2].trim() : CONFIG.DEFAULT_VALUES.CORPORATION_TYPE,
                    등기부상태: values[3] && values[3].trim() ? values[3].trim() : CONFIG.DEFAULT_VALUES.REGISTRY_STATUS,
                    본지점구분: values[4] && values[4].trim() ? values[4].trim() : CONFIG.DEFAULT_VALUES.BRANCH_TYPE,
                    주말여부: values[5] && values[5].trim() ? values[5].trim() : CONFIG.DEFAULT_VALUES.WEEKEND_OPTION
                });
            }
        }
        
        return companies;
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
        }
        if (this.rl) {
            this.rl.close();
        }
    }
}

// 메인 실행 함수
async function main() {
    const automation = new IROSAutomation();
    
    try {
        // CSV 파일이 있으면 CSV 모드, 없으면 사용자 입력 모드
        if (fs.existsSync('./train_data.csv')) {
            console.log('📂 CSV 파일 발견! CSV 모드로 실행합니다.');
            await automation.automateFromCSV();
        } else {
            console.log('📝 사용자 입력 모드로 실행합니다.');
            await automation.automateFromUserInput();
        }
    } catch (error) {
        console.error('❌ 실행 중 치명적 오류:', error.message);
        await automation.cleanup();
        process.exit(1);
    }
}

// 스크립트 직접 실행 시
if (require.main === module) {
    main().catch(console.error);
}

module.exports = IROSAutomation;

