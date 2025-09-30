const { chromium } = require('playwright');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

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
            return true;
        } catch (e) {
            try {
                await this.page.click(fallbackSelector);
                return true;
            } catch (e2) {
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
        
        // 다운로드 경로를 .playwright-mcp 폴더로 설정
        const downloadPath = path.join(__dirname, '.playwright-mcp');
        
        // .playwright-mcp 폴더가 없으면 생성
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath, { recursive: true });
            console.log(`📁 .playwright-mcp 폴더 생성: ${downloadPath}`);
        }
        
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
                '--window-size=1920,1080',
                `--download-directory=${downloadPath}` // 다운로드 경로 설정
            ]
        });
        
        this.context = await this.browser.newContext({
            acceptDownloads: true // 다운로드 허용
        });
        
        this.page = await this.context.newPage();
        
        // 브라우저 종료 감지 이벤트 리스너 추가 (중복 제거)
        this.browser.on('disconnected', () => {
            console.log('\n🔴 브라우저가 닫혔습니다. 프로그램을 종료합니다...');
            process.exit(0);
        });
        
        // 다운로드 이벤트 리스너 추가
        this.page.on('download', async (download) => {
            const fileName = download.suggestedFilename();
            const downloadPath = path.join(__dirname, '.playwright-mcp', fileName);
            await download.saveAs(downloadPath);
            console.log(`📥 파일 다운로드 완료: ${fileName}`);
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
            timeout: 50000
        });
        
        // 4단계: 페이지 완전 로딩 대기
        await this.page.waitForLoadState('domcontentloaded');
        await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT); // 추가 로딩 시간
        
        // 5단계: 팝업 및 배너 즉시 제거
        const removedCount = await this.page.evaluate(() => {
            let removedCount = 0;
            
            // 모든 가능한 닫기 버튼들 찾기
            const closeButtons = document.querySelectorAll('[class*="close"], [class*="popup"], [class*="modal"], button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close, .close-btn, [alt*="닫기"], [alt*="close"]');
            closeButtons.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.click();
                    removedCount++;
                }
            });
            
            // "오늘 다시 보지 않기" 링크 클릭
            const allLinks = document.querySelectorAll('a');
            allLinks.forEach(link => {
                if (link.textContent && link.textContent.includes('오늘 다시 보지 않기') && link.offsetParent !== null) {
                    link.click();
                    removedCount++;
                }
            });
            
            // 팝업 요소들 숨기기
            const popupElements = document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"], [class*="modal"], [id*="modal"]');
            popupElements.forEach(el => {
                if (el.offsetParent !== null) {
                    el.style.display = 'none';
                    removedCount++;
                }
            });
            
            return removedCount;
        });
        
        // 6단계: 브라우저 창 최대화 강제 실행
        await this.page.evaluate(() => {
            if (window.screen && window.screen.width && window.screen.height) {
                window.resizeTo(window.screen.width, window.screen.height);
                window.moveTo(0, 0);
            }
        });
        
        // 7단계: 추가 대기 후 다시 한 번 팝업 제거
        await this.waitWithTimeout(CONFIG.TIMEOUTS.DEFAULT);
        await this.page.evaluate(() => {
            document.querySelectorAll('[class*="popup"], [id*="popup"], [class*="layer"], [id*="layer"]').forEach(el => {
                if (el.offsetParent !== null) {
                    el.style.display = 'none';
                }
            });
        });
        
        // 8단계: 최종 확인
        const finalCheck = await this.page.evaluate(() => {
            const loginElements = Array.from(document.querySelectorAll('a')).filter(el => 
                el.textContent && el.textContent.includes('로그인')
            );
            
            return {
                loginFound: loginElements.length > 0
            };
        });
        
        if (!finalCheck.loginFound) {
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
        await this.page.evaluate(() => {
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
                    }
                });
            });
            
            // 닫기 버튼들 클릭
            const closeButtons = document.querySelectorAll('button[title*="닫기"], button[title*="close"], [onclick*="close"], .btn-close');
            closeButtons.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.click();
                }
            });
        });
    }

    // 🔧 개선된 결제 팝업 처리 메서드
    async handlePaymentPopup() {
        try {
            // 1단계: 팝업 메시지 존재 여부 확인
            const popupExists = await this.page.evaluate(() => {
                const texts = Array.from(document.querySelectorAll('*')).some(el => 
                    el.textContent && el.textContent.includes('결제할 등기사항증명서가 존재합니다')
                );
                return texts;
            });

            if (popupExists) {
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
                                return true;
                            } catch (e) {
                                // 클릭 실패 시 계속 시도
                            }
                        }
                    }
                    
                    // 방법 2: 링크 태그에서 취소 찾기
                    const links = Array.from(document.querySelectorAll('a'));
                    for (let link of links) {
                        if (link.textContent && link.textContent.includes('취소') && link.offsetParent !== null) {
                            try {
                                link.click();
                                return true;
                            } catch (e) {
                                // 클릭 실패 시 계속 시도
                            }
                        }
                    }
                    
                    // 방법 3: 버튼 태그에서 취소 찾기
                    const buttons = Array.from(document.querySelectorAll('button'));
                    for (let button of buttons) {
                        if (button.textContent && button.textContent.includes('취소') && button.offsetParent !== null) {
                            try {
                                button.click();
                                return true;
                            } catch (e) {
                                // 클릭 실패 시 계속 시도
                            }
                        }
                    }
                    
                    return false;
                });

                if (clickSuccess) {
                    await this.page.waitForTimeout(1000);
                    return true;
                } else {
                    // 3단계: ESC키로 대체 시도
                    await this.page.keyboard.press('Escape');
                    await this.page.waitForTimeout(500);
                    return true;
                }
            } else {
                return false;
            }
        } catch (e) {
            return false;
        }
    }

    // 🔧 개선된 법인 검색 페이지 이동 메서드
    async navigateToSearch() {
        console.log('🔍 법인 검색 페이지로 이동 중...');
        
        // 1단계: 먼저 결제 팝업 처리
        await this.handlePaymentPopup();
        
        // 2단계: MCP에서 성공한 방식으로 법인 열람·발급 버튼 클릭
        let clickResult = false;
        
        // 방법 1: MCP에서 성공한 방식 - getByRole 사용
        try {
            await this.page.getByRole('link', { name: '법인 열람·발급' }).click();
            clickResult = true;
        } catch (e1) {
            // 방법 2: JavaScript evaluate로 직접 찾기 (기존 방식 개선)
            try {
                clickResult = await this.page.evaluate(() => {
                    // 더 정확한 텍스트 매칭
                    const links = Array.from(document.querySelectorAll('a'));
                    
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
                        corporationLink.click();
                        return true;
                    }
                    
                    return false;
                });
            } catch (e2) {
                // JavaScript 방법도 실패
            }
        }

        if (!clickResult) {
            throw new Error('법인 열람·발급 버튼 클릭 실패');
        }
        
        // 3단계: 개선된 로딩 대기 방식
        try {
            // 먼저 짧은 시간으로 networkidle 시도
            await this.page.waitForLoadState('networkidle', { timeout: 8000 });
        } catch (e) {
            try {
                await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
            } catch (e2) {
                // 로딩 상태 대기 실패, 고정 시간 대기
            }
        }
        
        // 4단계: 페이지가 완전히 로드되고 결제 팝업이 나타날 시간 확보
        await this.page.waitForTimeout(3000);
        
        // 5단계: 페이지 로딩 완료 후 결제 팝업 확인 및 처리
        await this.handlePaymentPopup();
    }

    async navigateToHome() {
        console.log('🏠 홈화면으로 이동 중...');
        
        try {
            // 홈 버튼이 나타날 때까지 대기
            await this.page.waitForSelector('#mf_wfm_potal_main_wf_header_btn_home', { timeout: 10000 });
            
            // 홈 버튼 클릭
            await this.page.click('#mf_wfm_potal_main_wf_header_btn_home');
            
            // 페이지 로딩 대기
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(2000);
            
        } catch (e) {
            // 대안: URL로 직접 이동
            await this.page.goto('https://www.iros.go.kr/index.jsp', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(2000);
        }
    }

    // 각 회사별로 다른 검색 필터 설정
    async setupSearchFiltersForCompany(companyData) {
        try {
            // 1. 등기소 설정 (CSV에서 읽은 값 또는 기본값 사용)
            await this.page.getByLabel('등기소').selectOption({ label: companyData.등기소 });
            
            // 2. 법인구분 설정 (CSV에서 읽은 값 또는 기본값 사용)
            await this.page.getByLabel('법인구분').selectOption({ label: companyData.법인구분 });
            
            // 3. 등기부상태 설정 (CSV에서 읽은 값 또는 기본값 사용)
            await this.page.getByLabel('등기부상태').selectOption({ label: companyData.등기부상태 });
            
            // 4. 본지점구분 설정 (CSV에서 읽은 값 또는 기본값 사용)
            if (companyData.본지점구분 !== '전체 본지점') {
                await this.page.getByLabel('본지점구분').selectOption({ label: companyData.본지점구분 });
            }
            
            await this.page.waitForTimeout(500);
            
        } catch (error) {
            console.log(`⚠️ "${companyData.등기상호}" 검색 필터 설정 중 오류:`, error.message);
        }
    }

    // 기존 메서드 유지 (하위 호환성)
    async setupSearchFilters() {
        try {
            await this.page.getByLabel('등기소').selectOption({ label: '전체등기소' });
            await this.page.getByLabel('법인구분').selectOption({ label: '전체 법인(지배인, 미성년자, 법정대리인 제외)' });
            await this.page.getByLabel('등기부상태').selectOption({ label: '살아있는 등기' });
            
            await this.page.waitForTimeout(500);
            
        } catch (error) {
            console.log('⚠️ 검색 필터 설정 중 오류 발생:', error.message);
        }
    }

    async searchCompany(companyName) {
        console.log(`🔍 "${companyName}" 검색 중...`);
        
        try {
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
            } catch (e1) {
                // 방법 2: JavaScript로 정확한 ID 사용
                try {
                    const jsInputResult = await this.page.evaluate((companyName) => {
                        // 사용자가 제공한 정확한 ID로 입력 필드 찾기
                        let targetInput = document.getElementById('mf_wfm_potal_main_wfm_content_sbx_conm___input');
                        
                        if (!targetInput) {
                            // 대안 1: querySelector로 시도
                            targetInput = document.querySelector('#mf_wfm_potal_main_wfm_content_sbx_conm___input');
                        }
                        
                        if (!targetInput) {
                            // 대안 2: 상호명 관련 필드 찾기
                            const textInputs = document.querySelectorAll('input[type="text"]');
                            for (const input of textInputs) {
                                if ((input.placeholder && input.placeholder.includes('상호')) ||
                                    (input.name && input.name.includes('compNm')) ||
                                    (input.id && input.id.includes('conm'))) {
                                    targetInput = input;
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
                            return { success: true, value: targetInput.value };
                        }
                        
                        return { success: false, error: '등기상호 입력 필드를 찾을 수 없습니다' };
                    }, companyName);
                    
                    if (jsInputResult.success) {
                        inputSuccess = true;
                    }
                } catch (e2) {
                    // JavaScript 입력 중 예외
                }
            }
            
            if (!inputSuccess) {
                throw new Error('등기상호 입력 필드를 찾을 수 없습니다');
            }
            
            await this.page.waitForTimeout(1000);
            
            // Playwright 코드로 MCP 검색 명령 구현
            try {
                // 사용자가 제공한 정확한 검색 버튼 ID 사용 (요소가 준비될 때까지 대기)
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_conm_search', { timeout: 10000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_conm_search');
            } catch (e) {
                try {
                    // 대안 1: MCP에서 성공한 방식
                    await this.page.getByRole('link', { name: '검색' }).click();
                } catch (e2) {
                    // 대안 2: 더 광범위한 검색 버튼 selector
                    await this.page.click('a:has-text("검색"), button:has-text("검색"), input[value="검색"], [onclick*="search"]');
                }
            }
            
            // MCP에서 성공한 로딩 대기 방식
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(3000);
            
        } catch (error) {
            console.log(`❌ "${companyName}" 검색 실패:`, error.message);
            console.log('🔄 검색 실패로 홈페이지로 돌아가서 다음 회사로 진행');
            
            try {
                // 홈페이지로 돌아가기
                await this.navigateToHome();
                // 검색 페이지로 다시 이동
                await this.navigateToSearch();
            } catch (recoveryError) {
                console.log('⚠️ 페이지 복구 중 오류:', recoveryError.message);
            }
            
            throw error; // 에러를 던져서 다음 회사로 넘어가도록 함
        }
    }

    async selectCompanyAndProceed() {
        console.log('📋 검색 결과에서 첫 번째 회사 선택...');
        console.log('🔍 디버깅 시작 - 현재 페이지 상태 확인');
        console.log('📊 현재 URL:', await this.page.url());
        console.log('📄 현재 페이지 제목:', await this.page.title());
        
        // 페이지 분석
        try {
            const pageContent = await this.page.content();
            console.log('📄 페이지 HTML 길이:', pageContent.length);
            
            // 다음 버튼 분석
            const nextButtonInfo = await this.page.evaluate(() => {
                const info = {
                    exactButton: null,
                    textButtons: [],
                    pageText: ''
                };
                
                // 정확한 ID 버튼 확인
                const exactButton = document.querySelector('#mf_wfm_potal_main_wfm_content_btn_next');
                if (exactButton) {
                    info.exactButton = {
                        exists: true,
                        visible: exactButton.offsetParent !== null,
                        text: exactButton.textContent?.trim() || '',
                        className: exactButton.className
                    };
                } else {
                    info.exactButton = { exists: false };
                }
                
                // "다음" 텍스트가 있는 버튼들 확인
                const allElements = document.querySelectorAll('a, button, input');
                allElements.forEach((element, index) => {
                    if (element.textContent && element.textContent.includes('다음')) {
                        info.textButtons.push({
                            index: index,
                            tagName: element.tagName,
                            text: element.textContent.trim(),
                            visible: element.offsetParent !== null
                        });
                    }
                });
                
                // 검색 결과 없음 메시지 확인
                info.pageText = document.body.textContent || '';
                
                return info;
            });
            
            console.log('🔍 다음 버튼 분석 결과:');
            console.log('  - 정확한 ID 버튼:', nextButtonInfo.exactButton);
            console.log('  - "다음" 텍스트 버튼 개수:', nextButtonInfo.textButtons.length);
            if (nextButtonInfo.textButtons.length > 0) {
                console.log('  - "다음" 텍스트 버튼들:', nextButtonInfo.textButtons);
            }
            
            // 검색 결과 없음 메시지 확인
            if (nextButtonInfo.pageText.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                console.log('❌ 검색 결과 없음 메시지 발견!');
                console.log('⚡ 빠른 처리: 다음 회사로 즉시 넘어가기');
                throw new Error('상호명이 존재하지 않거나 검색 결과가 없음');
            } else {
                console.log('✅ 검색 결과 있음 확인됨');
            }
            
        } catch (error) {
            console.log('⚠️ 페이지 분석 중 오류:', error.message);
        }
        
        // 1단계: 먼저 다음 버튼 클릭 시도 (정상적인 경우)
        console.log('🔄 1단계: 정확한 ID로 다음 버튼 클릭 시도');
        try {
            console.log('⏳ 다음 버튼 대기 중... (10초)');
            await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_next', { 
                timeout: 10000,
                state: 'visible'
            });
            console.log('✅ 다음 버튼 발견됨, 클릭 시도 중...');
            await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
            console.log('✅ 1단계 성공: 정확한 ID로 클릭 완료');
            await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(2000);
                console.log('✅ 페이지 로딩 완료');
            return true; // 성공
        } catch (e) {
            console.log('⚠️ 1단계 실패:', e.message);
            console.log('🔍 1단계 실패 원인 분석:', e.name);
            
            // 2단계: 대안 방법 시도
            console.log('🔄 2단계: 텍스트 기반 다음 버튼 클릭 시도');
            try {
                console.log('⏳ 텍스트 기반 다음 버튼 대기 중... (8초)');
                await this.page.waitForSelector('link:has-text("다음")', { 
                    timeout: 8000,
                    state: 'visible'
                });
                console.log('✅ 텍스트 기반 다음 버튼 발견됨, 클릭 시도 중...');
                await this.page.click('link:has-text("다음")');
                console.log('✅ 2단계 성공: 텍스트 기반으로 클릭 완료');
                await this.page.waitForLoadState('networkidle');
                    await this.page.waitForTimeout(2000);
                    console.log('✅ 페이지 로딩 완료');
                return true; // 성공
            } catch (e2) {
                console.log('⚠️ 2단계 실패:', e2.message);
                console.log('🔍 2단계 실패 원인 분석:', e2.name);
                
                // 3단계: 검색 결과 확인
                console.log('🔄 3단계: 검색 결과 존재 여부 확인');
                const hasNoResults = await this.checkForNoSearchResults();
                
                if (hasNoResults) {
                    console.log('❌ 검색 결과가 없음 - 상호명이 존재하지 않는 것으로 간주');
                    throw new Error('상호명이 존재하지 않거나 검색 결과가 없음');
                } else {
                    console.log('❌ 다음 버튼이 없지만 검색 결과는 존재함 - 기타 오류로 간주');
                    console.log('🔍 최종 실패 원인: 다음 버튼을 찾을 수 없음');
                    throw new Error('다음 버튼 클릭 실패 - 기타 오류');
                }
            }
        }
    }

    // 검색 결과가 없는지 확인하는 메서드
    async checkForNoSearchResults() {
        console.log('🔍 검색 결과 없음 확인 시작...');
        console.log('📊 현재 URL:', await this.page.url());
        
        try {
            // 방법 1: 특정 XPath로 "검색조건에 맞는 법인등기기록을 찾지 못했습니다" 텍스트 확인
            console.log('🔄 방법 1: XPath 기반 검색 결과 없음 확인');
            const noResultsElement = await this.page.$('//*[@id="mf_wfm_potal_main_wfm_content_wq_uuid_4536"]/b/span');
            if (noResultsElement) {
                console.log('✅ XPath 요소 발견됨');
                const text = await noResultsElement.textContent();
                console.log('📝 XPath 요소 텍스트:', text);
                if (text && text.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                    console.log('✅ 방법 1 성공: XPath로 검색 결과 없음 확인됨');
                    return true;
                } else {
                    console.log('⚠️ 방법 1 실패: XPath 요소는 있지만 검색 결과 없음 텍스트가 아님');
                }
            } else {
                console.log('⚠️ 방법 1 실패: XPath 요소를 찾을 수 없음');
            }
            
            // 방법 2: 페이지 전체에서 해당 텍스트 검색
            console.log('🔄 방법 2: 페이지 전체 텍스트 검색');
            const pageContent = await this.page.content();
            console.log('📄 페이지 HTML 길이:', pageContent.length);
            if (pageContent.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                console.log('✅ 방법 2 성공: 페이지 전체에서 검색 결과 없음 텍스트 발견');
                return true;
            } else {
                console.log('⚠️ 방법 2 실패: 페이지 전체에서 검색 결과 없음 텍스트를 찾을 수 없음');
            }
            
            // 방법 3: JavaScript로 직접 확인
            console.log('🔄 방법 3: JavaScript 직접 확인');
            const hasNoResults = await this.page.evaluate(() => {
                console.log('🔍 JavaScript 실행 시작 - 검색 결과 없음 확인');
                
                // 특정 XPath 요소 확인
                const xpathElement = document.evaluate(
                    '//*[@id="mf_wfm_potal_main_wfm_content_wq_uuid_4536"]/b/span',
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;
                
                if (xpathElement) {
                    console.log('✅ XPath 요소 발견됨:', xpathElement.textContent);
                    if (xpathElement.textContent.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                        console.log('✅ XPath로 검색 결과 없음 확인됨');
                        return true;
                    }
                } else {
                    console.log('⚠️ XPath 요소를 찾을 수 없음');
                }
                
                // 전체 페이지에서 텍스트 검색
                console.log('🔍 전체 페이지에서 텍스트 검색 시작...');
                const allElements = Array.from(document.querySelectorAll('*'));
                console.log(`🔍 총 ${allElements.length}개 요소 검사 중...`);
                
                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i];
                    if (el.textContent && el.textContent.includes('검색조건에 맞는 법인등기기록을 찾지 못했습니다')) {
                        console.log(`✅ 요소 ${i+1}에서 검색 결과 없음 텍스트 발견:`, el.textContent.trim());
                        return true;
                    }
                }
                
                console.log('❌ 모든 요소에서 검색 결과 없음 텍스트를 찾을 수 없음');
                return false;
            });
            
            if (hasNoResults) {
                console.log('✅ 방법 3 성공: JavaScript로 검색 결과 없음 확인됨');
                return true;
            } else {
                console.log('⚠️ 방법 3 실패: JavaScript로도 검색 결과 없음을 찾을 수 없음');
            }
            
            console.log('✅ 모든 방법 실패: 검색 결과가 존재함으로 간주');
            return false;
            
        } catch (error) {
            console.log('❌ 검색 결과 확인 중 오류:', error.message);
            console.log('⚠️ 오류 시에는 검색 결과가 있다고 가정');
            return false; // 오류 시에는 검색 결과가 있다고 가정
        }
    }

    async setIssuanceOptions() {
        console.log('📄 발급 옵션 설정 중... (열람 선택)');
        
        try {
            // 🔧 1단계: 강화된 로딩 대기 (트래픽 고려)
            await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 });
            await this.page.waitForTimeout(3000); // 추가 대기
            
            // 🔧 2단계: 열람 라디오 버튼이 나타날 때까지 대기 (최대 30초)
            await this.page.waitForSelector('input[type="radio"][data-index="0"]', { 
                timeout: 30000,
                state: 'visible'
            });
            
            // 🔧 3단계: 추가 안정화 대기
            await this.page.waitForTimeout(2000);
            
            // 🔧 4단계: 열람 라디오 버튼 선택 (강화된 방식)
            await this.page.evaluate(() => {
                const viewRadio = document.querySelector('input[type="radio"][data-index="0"]');
                if (viewRadio && viewRadio.offsetParent !== null) { // 보이는 요소인지 확인
                    viewRadio.click();
                }
            });
            
            // 🔧 5단계: 선택 후 안정화 대기
            await this.page.waitForTimeout(1500);
            
            // 🔧 6단계: 다음 버튼 클릭 (다중 방법 시도) - 디버깅용
            console.log('🔘 다음 버튼 클릭 시도 중...');
            console.log('📊 현재 URL:', await this.page.url());
            console.log('📄 현재 페이지 제목:', await this.page.title());
            
            let nextButtonClicked = false;
            
            // 방법 1: 정확한 ID로 클릭
            try {
                console.log('🔄 방법 1: 정확한 ID 셀렉터 시도 (#mf_wfm_potal_main_wfm_content_btn_next)');
                console.log('⏳ 요소 대기 중... (10초)');
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_next', { 
                    timeout: 10000,
                    state: 'visible'
                });
                console.log('✅ 요소 발견됨, 클릭 시도 중...');
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
                console.log('✅ 방법 1 성공: 정확한 ID로 클릭 완료');
                nextButtonClicked = true;
            } catch (e1) {
                console.log('⚠️ 방법 1 실패:', e1.message);
                console.log('🔍 방법 1 실패 원인: 요소를 찾을 수 없거나 클릭할 수 없음');
                
                // 방법 2: 텍스트 기반 클릭
                try {
                    console.log('🔄 방법 2: 텍스트 기반 셀렉터 시도 (a:has-text("다음"), button:has-text("다음"))');
                    console.log('⏳ 텍스트 기반 요소 대기 중... (8초)');
                    await this.page.waitForSelector('a:has-text("다음"), button:has-text("다음")', { timeout: 8000 });
                    console.log('✅ 텍스트 기반 요소 발견됨, 클릭 시도 중...');
                    await this.page.click('a:has-text("다음"), button:has-text("다음")');
                    console.log('✅ 방법 2 성공: 텍스트 기반으로 클릭 완료');
                    nextButtonClicked = true;
                } catch (e2) {
                    console.log('⚠️ 방법 2 실패:', e2.message);
                    console.log('🔍 방법 2 실패 원인: 텍스트 기반 요소를 찾을 수 없음');
                    
                    // 방법 3: JavaScript로 직접 클릭
                    try {
                        console.log('🔄 방법 3: JavaScript 직접 클릭 시도');
                        console.log('🔍 JavaScript로 페이지 내 모든 요소 검색 중...');
                        const clickResult = await this.page.evaluate(() => {
                            console.log('🔍 JavaScript 실행 시작 - 다음 버튼 찾기');
                            
                            // 여러 방법으로 다음 버튼 찾기
                            const selectors = [
                                '#mf_wfm_potal_main_wfm_content_btn_next',
                                'a[href*="next"]',
                                'button[onclick*="next"]',
                                'input[value*="다음"]'
                            ];
                            
                            console.log('🔍 셀렉터 기반 검색 시작...');
                            for (let i = 0; i < selectors.length; i++) {
                                const selector = selectors[i];
                                console.log(`🔍 셀렉터 ${i+1}/${selectors.length} 시도: ${selector}`);
                                const element = document.querySelector(selector);
                                if (element && element.offsetParent !== null) {
                                    console.log(`✅ 셀렉터 ${i+1} 성공: ${selector}`);
                                    element.click();
                                    return { success: true, selector: selector, method: 'selector' };
                                } else {
                                    console.log(`❌ 셀렉터 ${i+1} 실패: ${selector}`);
                                }
                            }
                            
                            // 텍스트로 찾기
                            console.log('🔍 텍스트 기반 검색 시작...');
                            const allElements = document.querySelectorAll('a, button, input');
                            console.log(`🔍 총 ${allElements.length}개 요소 검사 중...`);
                            
                            for (let i = 0; i < allElements.length; i++) {
                                const element = allElements[i];
                                if (element.textContent && element.textContent.includes('다음') && element.offsetParent !== null) {
                                    console.log(`✅ 텍스트 기반 요소 ${i+1} 발견: "${element.textContent.trim()}"`);
                                    element.click();
                                    return { success: true, selector: 'text-based', method: 'text', text: element.textContent.trim() };
                                }
                            }
                            
                            console.log('❌ 모든 검색 방법 실패');
                            return { success: false, error: '다음 버튼을 찾을 수 없음' };
                        });
                        
                        if (clickResult.success) {
                            console.log(`✅ 방법 3 성공: JavaScript로 클릭 완료`);
                            console.log(`📊 성공 정보: ${clickResult.method} - ${clickResult.selector}`);
                            if (clickResult.text) {
                                console.log(`📝 클릭한 요소 텍스트: "${clickResult.text}"`);
                            }
                            nextButtonClicked = true;
                        } else {
                            console.log('❌ 방법 3 실패:', clickResult.error);
                            console.log('🔍 방법 3 실패 원인: JavaScript로도 다음 버튼을 찾을 수 없음');
                        }
                    } catch (e3) {
                        console.log('❌ 방법 3 실패:', e3.message);
                        console.log('🔍 방법 3 실패 원인: JavaScript 실행 중 오류 발생');
                    }
                }
            }
            
            if (!nextButtonClicked) {
                console.log('❌ 모든 다음 버튼 클릭 방법 실패');
                console.log('📊 실패 요약:');
                console.log('   - 방법 1: 정확한 ID 셀렉터 실패');
                console.log('   - 방법 2: 텍스트 기반 셀렉터 실패');
                console.log('   - 방법 3: JavaScript 직접 클릭 실패');
                throw new Error('모든 다음 버튼 클릭 방법 실패');
            } else {
                console.log('🎉 다음 버튼 클릭 최종 성공!');
            }
            
            // 🔧 7단계: 페이지 전환 대기 (트래픽 고려)
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
            await this.page.waitForTimeout(3000); // 추가 안정화 대기
            
        } catch (error) {
            console.log('⚠️ 발급 옵션 설정 중 오류:', error.message);
            console.log('🔄 발급 옵션 설정 실패로 홈페이지로 돌아가서 다음 회사로 진행');
            
            try {
                // 홈페이지로 돌아가기
                await this.navigateToHome();
                // 검색 페이지로 다시 이동
                await this.navigateToSearch();
            } catch (recoveryError) {
                console.log('⚠️ 페이지 복구 중 오류:', recoveryError.message);
            }
            
            throw new Error('발급 옵션 설정 실패 - 트래픽으로 인한 로딩 지연');
        }
    }

    
    async selectRegistryItems(){
        console.log('📝 등기 항목 선택 중...');
        
        try {
            // ✨ 수정된 부분: .first()를 추가하여 여러 요소 중 첫 번째 체크박스만 기다립니다.
            await this.page.locator('input[type="checkbox"][data-rowindex="14"]').first().waitFor();
        
            // evaluate 안의 querySelector는 자동으로 첫 번째 요소를 찾으므로 수정할 필요가 없습니다.
            await this.page.evaluate((registryItems) => {
                registryItems.forEach(rowIndex => {
                    const checkbox = document.querySelector(`input[type="checkbox"][data-rowindex="${rowIndex}"]`);
                    if (checkbox && !checkbox.checked) checkbox.click();
                });
            }, CONFIG.REGISTRY_ITEMS);
            
            // '다음' 버튼을 클릭합니다.
            await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
        
            // 로딩창이 사라질 때까지 기다립니다.
            const loadingFrame = this.page.locator('#__processbarIFrame');
            await loadingFrame.waitFor({ state: 'hidden', timeout: 20000 });
            
        } catch (error) {
            console.log('⚠️ 등기 항목 선택 중 오류:', error.message);
            console.log('🔄 등기 항목 선택 실패로 홈페이지로 돌아가서 다음 회사로 진행');
            
            try {
                // 홈페이지로 돌아가기
                await this.navigateToHome();
                // 검색 페이지로 다시 이동
                await this.navigateToSearch();
            } catch (recoveryError) {
                console.log('⚠️ 페이지 복구 중 오류:', recoveryError.message);
            }
            
            throw new Error('등기 항목 선택 실패');
        }
    }
// ▲▲▲▲▲ [끝] 여기까지 교체 ▲▲▲▲▲

    async setPrivacyOption(){
        console.log('🔒 주민등록번호 공개여부 설정 중...');
        
        try {
            // 먼저 중복결제 확인이 있는지 체크
            const hasDuplicate = await this.checkForDuplicatePayment();
            
            if (hasDuplicate) {
                console.log('✅ 중복결제 감지됨 - 중복결제 처리 시작');
                await this.handleDuplicatePaymentConfirmation();
                throw new Error('중복결제 - 등기상호검색 페이지로 이동됨');
            }
            
            // 중복결제가 없으면 미공개 라디오 버튼 처리
            await this.waitForPrivateRadioAndProcess();
            
        } catch (error) {
            console.error('❌ 처리 중 오류 발생:', error.message);
            
            // 중복결제 에러인 경우 특별 처리
            if (error.message.includes('중복결제')) {
                throw error; // 중복결제 에러는 그대로 전달
            }
            
            console.log('🔄 주민등록번호 공개여부 설정 실패로 홈페이지로 돌아가서 다음 회사로 진행');
            
            try {
                // 홈페이지로 돌아가기
                await this.navigateToHome();
                // 검색 페이지로 다시 이동
                await this.navigateToSearch();
            } catch (recoveryError) {
                console.log('⚠️ 페이지 복구 중 오류:', recoveryError.message);
            }
            
            throw error;
        }
    }
    
    // 중복결제 확인 함수 (간단한 체크)
    async checkForDuplicatePayment() {
        console.log('🔍 중복결제 감지 시작...');
        console.log('📊 현재 URL:', await this.page.url());
        
        try {
            // 방법 1: 특정 ID로 감지
            console.log('🔄 방법 1: ID 기반 중복결제 감지 시도');
            const duplicateElement = await this.page.$('#mf_wfm_potal_main_wfm_content_wq_uuid_14688');
            if (duplicateElement) {
                console.log('✅ 방법 1 성공: ID 기반 중복결제 감지됨');
                return true;
            } else {
                console.log('⚠️ 방법 1 실패: ID 기반 요소 없음');
            }
            
            // 방법 2: 텍스트로 감지
            console.log('🔄 방법 2: 텍스트 기반 중복결제 감지 시도');
            const pageContent = await this.page.content();
            console.log('📄 페이지 HTML 길이:', pageContent.length);
            
            const duplicateTexts = [
                '일괄결제대상에 이미 입력된 등기기록입니다',
                '일괄결제대상에 이미 입력된',
                '중복된 등기기록',
                '이미 등록된'
            ];
            
            for (const text of duplicateTexts) {
                if (pageContent.includes(text)) {
                    console.log(`✅ 방법 2 성공: 텍스트 기반 중복결제 감지됨 - "${text}"`);
                    return true;
                }
            }
            
            console.log('✅ 중복결제 없음 확인됨');
            return false;
            
        } catch (error) {
            console.log('❌ 중복결제 감지 중 오류:', error.message);
            return false;
        }
    }
    
    // A: 미공개 라디오 버튼 처리
    async waitForPrivateRadioAndProcess() {
        try {
            const privateRadio = this.page.getByRole('radio', { name: '미공개' });
            await privateRadio.waitFor({ timeout: 10000 });
            
            // 미공개 라디오 버튼 체크
            await privateRadio.check();
            
            // 체크 검증
            if (!(await privateRadio.isChecked())) {
                throw new Error('"미공개" 라디오 버튼을 체크하는데 실패했습니다.');
            }

            // 다음 버튼 클릭
            await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
        
            // 로딩창이 사라질 때까지 기다립니다.
            const loadingFrame = this.page.locator('#__processbarIFrame');
            await loadingFrame.waitFor({ state: 'hidden', timeout: 20000 });
        
            // 다음 페이지의 '다음' 버튼이 나타날 때까지 기다립니다.
            await this.page.locator('#mf_wfm_potal_main_wfm_content_btn_next').waitFor();
            
            return '미공개 처리 완료';
            
        } catch (error) {
            console.error('❌ 미공개 라디오 버튼 처리 중 오류:', error.message);
            throw error;
        }
    }
    

    // 중복결제 확인 처리 함수
    async handleDuplicatePaymentConfirmation() {
        console.log('🔄 중복결제 확인 창 처리 시작...');
        console.log('📊 현재 URL:', await this.page.url());
        
        try {
            // "처음으로" 버튼 클릭
            console.log('🔄 "처음으로" 버튼 클릭 시도');
            
            // 방법 1: 정확한 ID
            try {
                console.log('🔄 방법 1: 정확한 ID로 "처음으로" 버튼 클릭 시도');
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_first', { timeout: 3000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_first');
                console.log('✅ 방법 1 성공: 정확한 ID로 클릭 완료');
            } catch (e) {
                console.log('⚠️ 방법 1 실패:', e.message);
                
                // 방법 2: 텍스트 기반
                try {
                    console.log('🔄 방법 2: 텍스트 기반 "처음으로" 버튼 클릭 시도');
                    await this.page.click('link:has-text("처음으로")');
                    console.log('✅ 방법 2 성공: 텍스트 기반으로 클릭 완료');
                } catch (e2) {
                    console.log('⚠️ 방법 2 실패:', e2.message);
                    
                    // 방법 3: JavaScript 직접 클릭
                    console.log('🔄 방법 3: JavaScript 직접 "처음으로" 버튼 클릭 시도');
                    const clickResult = await this.page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('a'));
                        const firstButton = buttons.find(btn => btn.textContent.includes('처음으로'));
                        if (firstButton) {
                            firstButton.click();
                            return { success: true, text: firstButton.textContent.trim() };
                        }
                        return { success: false };
                    });
                    
                    if (clickResult.success) {
                        console.log(`✅ 방법 3 성공: JavaScript로 클릭 완료 - "${clickResult.text}"`);
                    } else {
                        console.log('❌ 방법 3 실패: JavaScript로도 "처음으로" 버튼을 찾을 수 없음');
                    }
                }
            }
            
            // 페이지 로딩 대기
            console.log('⏳ 페이지 로딩 대기 중...');
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            console.log('✅ 중복결제 처리 완료');
            
            return true; // 중복결제 처리가 완료되었음을 반환
            
        } catch (e) {
            console.log('❌ 중복결제 처리 중 오류:', e.message);
            return false;
        }
    }

    async finalConfirmation(isLastInBatch = false, isLastBatch = false) {
        console.log('🎯 최종 확인 및 결제 페이지 이동...');
        
        try {
            // 🎯 등기사항증명서 확인 페이지에서 다음 버튼 클릭
            try {
                await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_next', { timeout: 10000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_next');
            } catch (e) {
                await this.page.click('link:has-text("다음")');
            }
            
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            
            // 🎯 결제대상확인 페이지에서 추가 또는 결제 버튼 클릭
            if (isLastInBatch && isLastBatch) {
                // 배치의 마지막 회사이고 전체 마지막 배치인 경우: 결제 버튼 클릭
                try {
                    await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_pay', { timeout: 10000 });
                    await this.page.click('#mf_wfm_potal_main_wfm_content_btn_pay');
                } catch (e) {
                    await this.page.click('link:has-text("결제")');
                }
            } else if (isLastInBatch && !isLastBatch) {
                // 배치의 마지막 회사이지만 전체 마지막 배치가 아닌 경우: 아무 버튼도 누르지 않음
                console.log('✅ 배치 완료 - 추가 버튼을 누르지 않고 결제 대기 상태로 유지');
            } else {
                // 배치 중간 회사인 경우: 추가 버튼 클릭
                try {
                    await this.page.waitForSelector('#mf_wfm_potal_main_wfm_content_btn_new_add', { timeout: 10000 });
                await this.page.click('#mf_wfm_potal_main_wfm_content_btn_new_add');
            } catch (e) {
                await this.page.click('link:has-text("추가")');
            }
            }
            
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(3000);
            
        } catch (error) {
            console.log('⚠️ 최종 확인 및 결제 페이지 이동 중 오류:', error.message);
            console.log('🔄 최종 확인 실패로 홈페이지로 돌아가서 다음 회사로 진행');
            
            try {
                // 홈페이지로 돌아가기
                await this.navigateToHome();
                // 검색 페이지로 다시 이동
                await this.navigateToSearch();
            } catch (recoveryError) {
                console.log('⚠️ 페이지 복구 중 오류:', recoveryError.message);
            }
            
            throw new Error('최종 확인 및 결제 페이지 이동 실패');
        }
    }

    async processCompany(companyData, isFirst = true, isLastInBatch = false, isLastBatch = false) {
        const companyName = companyData.등기상호;
        console.log(`\n🏢 ===== "${companyName}" 처리 시작 =====`);
        
        try {
            // 🎯 각 회사마다 CSV에서 읽은 실제 검색 조건 적용
            await this.setupSearchFiltersForCompany(companyData);

            // 🎯 모든 회사마다 동일한 방식으로 처리
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
            
            // 모든 오류에 대해 홈페이지로 돌아가서 다음 회사로 진행
            console.log(`🔄 "${companyName}" - 오류 발생으로 홈페이지로 돌아가서 다음 회사로 진행`);
            
            try {
                // 홈페이지로 돌아가기
                console.log('🏠 홈페이지로 돌아가는 중...');
                await this.navigateToHome();
                
                // 검색 페이지로 다시 이동
                console.log('🔍 검색 페이지로 재이동 중...');
                await this.navigateToSearch();
                
                console.log('✅ 페이지 상태 복구 완료 - 다음 회사 처리 준비됨');
                
            } catch (recoveryError) {
                console.log('⚠️ 페이지 복구 중 오류:', recoveryError.message);
                console.log('🔄 브라우저 새로고침으로 복구 시도...');
                
                try {
                    await this.page.reload();
                    await this.page.waitForLoadState('domcontentloaded');
                    await this.waitWithTimeout(3000);
                    console.log('✅ 브라우저 새로고침으로 복구 완료');
                } catch (reloadError) {
                    console.log('❌ 브라우저 새로고침도 실패:', reloadError.message);
                }
            }
            
            // 실패한 회사 정보 저장
            this.failedCompanies.push({ 
                company: companyName, 
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
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
                    } else {
                        failCount++;
                    }
                }
                
                console.log(`\n📊 배치 ${batchNumber} 결과: 성공 ${successCount}개, 실패 ${failCount}개`);
                
                // 배치 완료 후 사용자에게 결제 요청
                if (successCount > 0) {
                    console.log(`\n🎉 배치 ${batchNumber} 완료! ${successCount}개 회사가 결제 페이지에 추가되었습니다.`);
                    console.log('💳 이제 결제를 진행해주세요.');
                } else {
                    console.log(`\n⚠️ 배치 ${batchNumber} 완료! 성공한 회사가 없습니다.`);
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
            
            console.log(`📊 CSV에서 ${companies.length}개 회사 발견`);
            
            // 10개씩 나눠서 처리할 배치 개수 계산
            const batchSize = CONFIG.BATCH_SIZE;
            const totalBatches = Math.ceil(companies.length / batchSize);
            console.log(`\n🔢 처리 방식: 10개씩 나눠서 ${totalBatches}개 배치로 처리`);
            
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
        
        console.log('\n🎯 자동화 완료!');
        
        // printSummary 함수에서 결제 확인 및 test_pay.js 실행을 처리
        await this.printSummary();
        
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
            
            const companyInput = await this.askQuestion('회사명 목록을 입력하세요: ');
            if (!companyInput || !companyInput.trim()) {
                throw new Error('회사명이 입력되지 않았습니다.');
            }
            
            companies = companyInput.split(',').map(name => name.trim()).filter(name => name);
            
            if (companies.length === 0) {
                throw new Error('유효한 회사명이 없습니다.');
            }
            
            console.log(`\n📊 총 ${companies.length}개 회사 처리 예정`);
            
            // 10개씩 나눠서 처리할 배치 개수 계산
            const batchSize = CONFIG.BATCH_SIZE;
            const totalBatches = Math.ceil(companies.length / batchSize);
            console.log(`\n🔢 처리 방식: 10개씩 나눠서 ${totalBatches}개 배치로 처리`);
            
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
        
        // 모든 처리가 완료되면 사용자에게 PDF 다운로드 여부 확인
        console.log('\n🎉 모든 등기 신청이 완료되었습니다!');
        console.log('📄 신청결과확인 화면에서 등기들을 다운로드 하시겠습니까? (y/n): ');
        
        // 기존 readline 인터페이스 사용 (중복 생성 방지)
        return new Promise((resolve, reject) => {
            // 입력 대기 시간을 조금 주어 버퍼 정리
            setTimeout(() => {
                this.rl.question('', async (answer) => {
                    // 입력값 디버깅 로그
                    console.log(`🔍 입력된 값: "${answer}" (길이: ${answer.length})`);
                    
                    // 입력값 정리 및 검증 강화
                    const trimmedAnswer = answer.trim().toLowerCase();
                    console.log(`🔍 정리된 값: "${trimmedAnswer}"`);
                    
                    // 다양한 입력 형태 지원
                    const isYes = trimmedAnswer === 'y' || 
                                 trimmedAnswer === 'yes' || 
                                 trimmedAnswer === '그렇다' || 
                                 trimmedAnswer === 'ㅇ' ||
                                 trimmedAnswer === '예' ||
                                 trimmedAnswer === '1';
                    
                    if (isYes) {
                    console.log('🚀 PDF 다운로드를 시작합니다...');
                    
                    try {
                        // 통합된 PDF 다운로드 기능 실행
                        await this.processPaymentAndDownload();
                        console.log('✅ PDF 다운로드 완료');
                    } catch (error) {
                        console.log('❌ PDF 다운로드 중 오류:', error.message);
                    }
                    
                    resolve();
                } else {
                    console.log('💡 PDF 다운로드를 진행하지 않으셨습니다. 프로그램을 종료합니다.');
                    resolve();
                }
            });
            }, 100); // 100ms 대기로 입력 버퍼 정리
        });
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

    // ===== test_pay.js 기능 통합 =====
    
    // 결제 완료 후 열람/발급 자동화 (메인 함수)
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


    // 홈페이지로 이동하여 팝업 제거
    async goToHomePageAndRemovePopups() {
        try {
            console.log('🏠 홈페이지로 이동 중...');
            await this.page.goto('https://www.iros.go.kr/');
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            
            // 팝업 제거 시도
            try {
                await this.page.click('button:has-text("닫기")', { timeout: 3000 });
                console.log('✅ 팝업 제거 완료');
            } catch (e) {
                console.log('ℹ️ 제거할 팝업이 없습니다.');
            }
            
        } catch (error) {
            console.log('❌ 홈페이지 이동 중 오류:', error.message);
        }
    }

    // 열람·발급 메뉴로 이동 (법인 신청결과 화면)
    async navigateToViewIssueMenu() {
        try {
            // 홈페이지로 이동
            console.log('🏠 홈페이지로 이동합니다...');
            await this.navigateToHome();
            
            // 1단계: 첫 번째 열람·발급 메뉴 클릭 (상단 메뉴바의 메인 메뉴)
            console.log('🔍 1단계: 첫 번째 열람·발급 메뉴 클릭 중...');
            
            const clickResult1 = await this.page.evaluate(() => {
                const targetElement = document.querySelector('#mf_wfm_potal_main_wf_header_wq_uuid_503');
                if (targetElement) {
                    targetElement.click();
                    return '열람·발급 메뉴 클릭 성공';
                } else {
                    return '열람·발급 메뉴를 찾을 수 없음';
                }
            });
            
            console.log(`📋 JavaScript 클릭 결과: ${clickResult1}`);
            await this.page.waitForTimeout(2000);
            console.log('✅ 1단계 완료: 첫 번째 열람·발급 메뉴 클릭 완료');
            
            // 2단계: 법인 섹션의 "신청결과 확인 (미열람·미발급/재열람 등)" 링크 클릭
            console.log('🔍 2단계: 법인 섹션의 신청결과 확인 링크 클릭 중...');
            
            try {
                const clickResult = await this.page.evaluate(() => {
                    // 방법 1: 정확한 ID로 법인 섹션의 신청결과 확인 메뉴 클릭
                    const targetElement = document.querySelector('#mf_wfm_potal_main_wf_header_gen_depth1_0_gen_depth2_1_gen_depth3_6_btn_top_menu3b');
                    if (targetElement) {
                        targetElement.click();
                        return '법인 신청결과 확인 메뉴 클릭 성공 (ID 방식)';
                    }
                    
                    // 방법 2: 법인 섹션 내의 신청결과 확인 링크를 찾아서 클릭
                    const allLinks = document.querySelectorAll('a');
                    for (let link of allLinks) {
                        const text = link.textContent;
                        if (text && text.includes('신청결과 확인') && text.includes('미열람')) {
                            // 부모 요소들을 확인하여 법인 섹션인지 판단
                            let currentElement = link.parentElement;
                            let isCorporateSection = false;
                            
                            while (currentElement && currentElement !== document.body) {
                                const parentText = currentElement.textContent || '';
                                if (parentText.includes('법인') && !parentText.includes('부동산')) {
                                    isCorporateSection = true;
                                    break;
                                }
                                currentElement = currentElement.parentElement;
                            }
                            
                            if (isCorporateSection) {
                                link.click();
                                return '법인 섹션 신청결과 확인 메뉴 클릭 성공 (텍스트 검색)';
                            }
                        }
                    }
                    
                    return '법인 신청결과 확인 메뉴를 찾을 수 없음';
                });
                
                console.log(`📋 JavaScript 클릭 결과: ${clickResult}`);
                
            } catch (error) {
                console.log('⚠️ JavaScript 클릭 실패, 대체 방법 시도...');
                
                // 법인 섹션의 신청결과 확인 링크를 정확히 찾기
                const allResultLinks = await this.page.$$('a:has-text("신청결과 확인")');
                console.log(`📋 찾은 신청결과 확인 링크 개수: ${allResultLinks.length}`);
                
                let clicked = false;
                for (let i = 0; i < allResultLinks.length; i++) {
                    const link = allResultLinks[i];
                    const text = await link.textContent();
                    console.log(`🔍 링크 ${i + 1} 텍스트: "${text}"`);
                    
                    // 정확한 링크인지 확인 (미열람 포함)
                    if (text.includes('신청결과 확인') && text.includes('미열람')) {
                        // 부동산 섹션이 아닌 법인 섹션의 링크인지 확인
                        const parentText = await link.evaluate(el => {
                            const parent = el.closest('li');
                            return parent ? parent.textContent : '';
                        });
                        
                        if (parentText.includes('법인') && !parentText.includes('부동산')) {
                            await link.click();
                            await this.waitWithTimeout(3000);
                            console.log(`✅ 법인 섹션의 신청결과 확인 링크 클릭 완료: "${text}"`);
                            clicked = true;
                            break;
                        }
                    }
                }
                
                if (!clicked) {
                    console.log('⚠️ 법인 섹션의 신청결과 확인 링크를 찾지 못했습니다. 직접 URL로 이동합니다.');
                    await this.page.goto('https://www.iros.go.kr/biz/Pc20VipRgsCtrl/callRgsList.do');
                    await this.waitWithTimeout(3000);
                    console.log('✅ 직접 URL로 이동 완료');
                }
            }
            
            // 페이지 로딩 완료 대기
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            
            // 페이지 이동 확인
            const currentUrl = await this.page.url();
            console.log(`📊 현재 URL: ${currentUrl}`);
            
            if (currentUrl.includes('callRgsList.do')) {
                console.log('✅ 신청결과 확인 페이지 도달 확인됨');
            } else {
                console.log('⚠️ 페이지 이동 확인 필요');
            }
            
            console.log('🎉 모든 네비게이션 단계 완료: 법인 등기사항증명서 열람·발급 신청결과 페이지 도달');
            
        } catch (error) {
            console.log('❌ 열람·발급 메뉴 이동 중 오류:', error.message);
            throw error;
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
                await this.page.waitForTimeout(2000);
            }
            
        } catch (error) {
            console.log('⚠️ 결제 완료 화면을 찾을 수 없습니다. 계속 진행합니다.');
        }
    }

    // 모든 등기 처리
    // 모든 등기에 대해 순차적으로 처리 (페이지네이션 포함) - test_pay.js 방식
    async processAllRegistrations() {
        try {
            let currentPage = 1;
            let hasMorePages = true;
            
            while (hasMorePages) {
                console.log(`\n📄 페이지 ${currentPage} 처리 중...`);
                
                // 현재 페이지의 모든 등기 처리
                const hasMoreOnCurrentPage = await this.processCurrentPage();
                
                if (hasMoreOnCurrentPage) {
                    // 다음 페이지로 이동 시도
                    try {
                        await this.goToNextPageInResults();
                        currentPage++;
                        await this.page.waitForTimeout(2000);
                    } catch (e) {
                        console.log('✅ 더 이상 페이지가 없습니다.');
                        hasMorePages = false;
                    }
                } else {
                    hasMorePages = false;
                }
            }
            
            console.log('✅ 모든 등기 처리 완료');
            
        } catch (error) {
            console.log('❌ 등기 처리 중 오류:', error.message);
        }
    }

    // 현재 페이지의 모든 등기 처리 - test_pay.js 방식
    async processCurrentPage() {
        try {
            let registrationIndex = 0;
            let hasMoreRegistrations = true;
            
            while (hasMoreRegistrations) {
                console.log(`\n🔍 등기 ${registrationIndex + 1} 처리 중...`);
                
                try {
                // 열람 버튼 찾기 및 클릭
                    const viewButtonClicked = await this.findAndClickViewButton(registrationIndex);
                
                    if (viewButtonClicked) {
                        // 열람 창 처리
                    await this.handleViewWindow();
                    
                        // 다음 등기로 이동
                        registrationIndex++;
                    await this.page.waitForTimeout(1000);
                } else {
                        console.log('❌ 열람 버튼을 찾을 수 없습니다. 현재 페이지 처리 완료');
                        hasMoreRegistrations = false;
                    }
                    
                } catch (error) {
                    console.log('❌ 등기 처리 중 오류:', error.message);
                    hasMoreRegistrations = false;
                }
            }
            
            return registrationIndex > 0; // 처리된 등기가 있으면 true
            
        } catch (error) {
            console.log('❌ 현재 페이지 처리 중 오류:', error.message);
            return false;
        }
    }

    // 다음 페이지로 이동 (결과 목록에서)
    async goToNextPageInResults() {
        try {
            console.log('🔄 다음 페이지로 이동 시도 중...');
            
            // 다음 페이지 버튼 찾기 및 클릭
            const nextButton = await this.page.locator('a:has-text("다음")').first();
            if (await nextButton.isVisible()) {
                await nextButton.click();
                await this.page.waitForLoadState('networkidle');
                console.log('✅ 다음 페이지로 이동 완료');
                    return true;
                } else {
                throw new Error('다음 페이지 버튼을 찾을 수 없음');
            }
            
        } catch (error) {
            console.log('❌ 다음 페이지 이동 실패:', error.message);
            throw error;
        }
    }

    // 열람 버튼 찾기 및 클릭 (test_pay.js 방식 적용)
    async findAndClickViewButton(index) {
        try {
            console.log(`🔍 열람 버튼 ${index + 1} 찾는 중...`);
            
            // test_pay.js에서 검증된 간단하고 효과적인 방법 사용
            const viewButtons = await this.page.locator('button:has-text("열람")').all();
            console.log(`📋 찾은 열람 버튼 개수: ${viewButtons.length}`);
            
            if (viewButtons && viewButtons.length > 0) {
                // test_pay.js 방식: 항상 첫 번째 열람 버튼 클릭 (DOM 변경으로 인한 인덱스 문제 해결)
                console.log(`🔍 첫 번째 열람 버튼 클릭 중... (등기 ${index + 1} 처리)`);
                await viewButtons[0].click();
                await this.page.waitForTimeout(2000);
                
                // 확인 대화상자 처리
                await this.handleConfirmationDialog();
                
                return true;
            } else {
                console.log(`❌ 열람 버튼을 찾을 수 없습니다. (총 ${viewButtons.length}개 발견)`);
                
                // 🔍 디버깅: 페이지의 모든 버튼 정보 출력 (실패 시에만)
                const allButtons = await this.page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
                    return buttons.map((btn, i) => ({
                        index: i,
                        tagName: btn.tagName,
                        text: btn.textContent?.trim() || btn.value?.trim() || '',
                        title: btn.title || '',
                        visible: btn.offsetParent !== null
                    })).filter(btn => btn.visible);
                });
                
                console.log(`📋 페이지에서 찾은 모든 버튼들 (${allButtons.length}개):`);
                allButtons.forEach(btn => {
                    if (btn.text.includes('열람') || btn.text.includes('발급') || btn.title.includes('열람') || btn.title.includes('발급')) {
                        console.log(`  🎯 [${btn.index}] ${btn.tagName}: "${btn.text}" (title: "${btn.title}")`);
                    }
                });
                
                return false;
            }
            
        } catch (error) {
            console.log('❌ 열람 버튼 클릭 중 오류:', error.message);
            return false;
        }
    }

    // 확인 대화상자 처리 (test_pay.js 방식)
    async handleConfirmationDialog() {
        try {
            console.log('🔍 확인 대화상자 찾는 중...');
            
            // 여러 가지 방법으로 확인 버튼 찾기 시도
            let confirmButton = null;
            
            // 방법 1: 정확한 팝업 창 내부의 확인 버튼 찾기
            try {
                confirmButton = await this.page.waitForSelector('div[id*="message_popup"][id*="wframe_grp_type2"] a[id*="btn_confirm2"]', { 
                    timeout: 3000,
                    state: 'visible'
                });
                console.log('✅ 팝업 창 type2 그룹의 확인 버튼 찾음');
            } catch (error) {
                console.log('⚠️ 팝업 창 type2 그룹의 확인 버튼 찾을 수 없음');
            }
            
            // 방법 2: link:has-text("확인")
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('link:has-text("확인")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ link:has-text("확인") 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ link:has-text("확인") 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 3: button:has-text("확인")
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('button:has-text("확인")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ button:has-text("확인") 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ button:has-text("확인") 선택자로 찾을 수 없음');
                }
            }
            
            if (confirmButton) {
                console.log('⚠️ 확인 대화상자가 나타났습니다. "확인" 버튼을 클릭합니다.');
                
                // 여러 가지 클릭 방법 시도
                let clickSuccess = false;
                
                // 방법 1: 일반 클릭
                try {
                    await confirmButton.click();
                    console.log('✅ 일반 클릭 성공');
                    clickSuccess = true;
                } catch (error) {
                    console.log('⚠️ 일반 클릭 실패:', error.message);
                }
                
                // 방법 2: force 옵션으로 클릭
                if (!clickSuccess) {
                    try {
                        await confirmButton.click({ force: true });
                        console.log('✅ force 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ force 클릭 실패:', error.message);
                    }
                }
                
                if (clickSuccess) {
                    console.log('✅ 확인 대화상자 처리 완료');
                    await this.page.waitForTimeout(2000);
                } else {
                    console.log('❌ 모든 클릭 방법이 실패했습니다.');
                }
            } else {
                console.log('ℹ️ 확인 대화상자가 없습니다. 계속 진행합니다.');
            }
            
        } catch (error) {
            console.log('❌ 확인 대화상자 처리 중 오류:', error.message);
            return false;
        }
    }

    // 열람 창 처리
    async handleViewWindow() {
        try {
            // 열람 창이 완전히 로드될 때까지 대기
            await this.waitForViewWindowToLoad();
            
            // 저장 버튼 클릭
            await this.clickDownloadButton();
            
            // change.py 실행 (실패해도 계속 진행)
            try {
                await this.runChangePy();
            } catch (error) {
                console.log('⚠️ change.py 실행 실패했지만 계속 진행합니다:', error.message);
            }
            
            // 열람 창 닫기 (반드시 실행)
            console.log('🔚 열람 창을 닫습니다...');
            await this.closeViewWindow();
            
        } catch (error) {
            console.log('❌ 열람 창 처리 중 오류:', error.message);
            // 오류가 발생해도 닫기 버튼은 시도
            try {
                console.log('🔚 오류 발생했지만 열람 창을 닫으려고 시도합니다...');
                await this.closeViewWindow();
            } catch (closeError) {
                console.log('❌ 닫기 버튼 클릭도 실패:', closeError.message);
            }
        }
    }

    // 열람 창 로딩 대기
    async waitForViewWindowToLoad() {
        try {
            console.log('⏳ 열람 창 로딩 대기 중...');
            
            // "처리 중입니다" 로딩 화면이 사라지고 열람 창이 나타날 때까지 대기
            // h3 태그의 "법인 등기사항증명서 열람·발급 신청결과" 제목이 나타날 때까지 대기
            await this.page.waitForSelector('h3.w2textbox.df-tit:has-text("법인 등기사항증명서 열람·발급 신청결과")', { 
                timeout: 30000,
                state: 'visible'
            });
            
            console.log('✅ 열람 창 로딩 완료 - 신청결과 페이지 확인됨');
            await this.page.waitForTimeout(2000); // 추가 안정화 대기
            
        } catch (error) {
            console.log('⚠️ 열람 창 로딩 대기 중 오류:', error.message);
            // 로딩 실패해도 계속 진행
        }
    }

    // 저장 버튼 클릭 (개선된 방식)
    async clickDownloadButton() {
        try {
            console.log('💾 모달 창의 저장 버튼 클릭 중...');
            
            // 1단계: 모달 창 완전 로딩 대기
            await this.page.waitForLoadState('networkidle', { timeout: 15000 });
            await this.page.waitForTimeout(3000); // 모달 창 안정화 대기
            
            // 2단계: 저장 버튼 찾기 (다중 방법 시도)
            let downloadButton = null;
            
            // 방법 1: input[type="button"][value="저장"] 찾기
            try {
                downloadButton = await this.page.waitForSelector('input[type="button"][value="저장"]', { 
                    timeout: 8000,
                    state: 'visible'
                });
                console.log('✅ 방법 1 성공: input[type="button"][value="저장"]로 찾음');
            } catch (e1) {
                console.log('⚠️ 방법 1 실패:', e1.message);
                
                // 방법 2: button 태그로 찾기
                try {
                    downloadButton = await this.page.waitForSelector('button:has-text("저장")', { 
                        timeout: 8000,
                        state: 'visible'
                    });
                    console.log('✅ 방법 2 성공: button:has-text("저장")로 찾음');
                } catch (e2) {
                    console.log('⚠️ 방법 2 실패:', e2.message);
                    
                    // 방법 3: input 태그로 찾기
                    try {
                        downloadButton = await this.page.waitForSelector('input[value="저장"]', { 
                            timeout: 8000,
                            state: 'visible'
                        });
                        console.log('✅ 방법 3 성공: input[value="저장"]로 찾음');
                    } catch (e3) {
                        console.log('⚠️ 방법 3 실패:', e3.message);
                        
                        // 방법 4: JavaScript로 직접 찾기
                        const buttonInfo = await this.page.evaluate(() => {
                            // 저장 버튼 관련 요소들 찾기
                            const selectors = [
                'input[type="button"][value="저장"]', 
                                'input[value="저장"]',
                                'button:contains("저장")',
                                'input[type="submit"][value="저장"]',
                                'button[type="submit"]:contains("저장")'
                            ];
                            
                            for (let selector of selectors) {
                                try {
                                    const element = document.querySelector(selector);
                                    if (element && element.offsetParent !== null) {
                                        return {
                                            found: true,
                                            selector: selector,
                                            tagName: element.tagName,
                                            value: element.value || element.textContent,
                                            visible: element.offsetParent !== null
                                        };
                    }
                } catch (e) {
                                    continue;
                                }
                            }
                            return { found: false };
                        });
                        
                        if (buttonInfo.found) {
                            console.log('✅ 방법 4 성공: JavaScript로 저장 버튼 찾음');
                            console.log(`   - 선택자: ${buttonInfo.selector}`);
                            console.log(`   - 태그: ${buttonInfo.tagName}`);
                            console.log(`   - 값: ${buttonInfo.value}`);
                            
                            // JavaScript로 직접 클릭 시도
                            const clickResult = await this.page.evaluate(() => {
                                const selectors = [
                                    'input[type="button"][value="저장"]', 
                                    'input[value="저장"]',
                                    'button:contains("저장")',
                                    'input[type="submit"][value="저장"]',
                                    'button[type="submit"]:contains("저장")'
                                ];
                                
                                for (let selector of selectors) {
                                    try {
                                        const element = document.querySelector(selector);
                                        if (element && element.offsetParent !== null) {
                                            element.click();
                                            return true;
                                        }
                                    } catch (e) {
                                        continue;
                                    }
                                }
            return false;
                            });
                            
                            if (clickResult) {
                                downloadButton = true; // 클릭 성공 표시
                            } else {
                                console.log('❌ 방법 4 실패: JavaScript로도 저장 버튼을 찾을 수 없음');
                            }
                        }
                    }
                }
            }
            
            // 3단계: 클릭 실행
            if (downloadButton) {
                let clickSuccess = false;
                
                if (downloadButton !== true) { // JavaScript 클릭이 아닌 경우
                    try {
                        await downloadButton.click({ timeout: 15000 });
                        clickSuccess = true;
                        console.log('✅ 저장 버튼 클릭 성공');
                    } catch (clickError) {
                        console.log('❌ 저장 버튼 클릭 실패:', clickError.message);
                        clickSuccess = false;
                    }
                } else {
                    // JavaScript 클릭은 이미 성공했다고 가정
                    clickSuccess = true;
                    console.log('✅ JavaScript로 저장 버튼 클릭 성공');
                }
                
                // 4단계: 클릭 성공 시에만 다운로드 대기 및 메시지 출력
                if (clickSuccess) {
                    console.log('✅ 모달 창의 저장 버튼 클릭 완료');
                    await this.page.waitForTimeout(5000); // 다운로드 완료 대기
                    console.log('📥 PDF 다운로드가 시작되었습니다...');
                } else {
                    console.log('❌ 저장 버튼 클릭이 실패했습니다. 다운로드를 진행할 수 없습니다.');
                }
                
            } else {
                console.log('❌ 저장 버튼을 찾을 수 없습니다.');
                
                // 🔍 디버깅: 페이지의 모든 버튼 정보 출력
                const allButtons = await this.page.evaluate(() => {
                    const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
                    return Array.from(buttons).map(btn => ({
                        tagName: btn.tagName,
                        type: btn.type,
                        value: btn.value,
                        textContent: btn.textContent?.trim(),
                        visible: btn.offsetParent !== null,
                        id: btn.id,
                        className: btn.className
                    }));
                });
                
                console.log('🔍 페이지의 모든 버튼 정보:');
                allButtons.forEach((btn, index) => {
                    console.log(`  ${index + 1}. ${btn.tagName}[type="${btn.type}"] - value:"${btn.value}" text:"${btn.textContent}" visible:${btn.visible}`);
                });
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
            const changePyPath = path.join(__dirname, 'change.py');

            return new Promise((resolve, reject) => {
                const pythonProcess = spawn('python', [changePyPath], {
                    stdio: ['pipe', 'inherit', 'inherit'],
                    cwd: __dirname,
                    shell: false
                });

                // 자동으로 "1" 입력
                pythonProcess.stdin.write('1\n');
                pythonProcess.stdin.end();

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
            console.log('❌ 모달 창 닫기 중...');
            
            // 모달 창의 닫기 버튼 찾기 및 클릭
            const closeButton = await this.page.waitForSelector(
                'input[type="button"][value="닫기"]', 
                { timeout: 5000 }
            );
            
            if (closeButton) {
                await closeButton.click();
                console.log('✅ 모달 창 닫기 완료');
                await this.page.waitForTimeout(1000);
            }
                
        } catch (error) {
            console.log('❌ 모달 창 닫기 중 오류:', error.message);
        }
    }

    async cleanup() {
        try {
            console.log('🧹 리소스 정리 중...');
            
        if (this.context) {
            await this.context.close();
                console.log('✅ 브라우저 컨텍스트 정리 완료');
        }
        if (this.browser) {
            await this.browser.close();
                console.log('✅ 브라우저 정리 완료');
        }
        if (this.rl) {
            this.rl.close();
                console.log('✅ readline 인터페이스 정리 완료');
            }
            
            console.log('✅ 모든 리소스 정리 완료');
        } catch (error) {
            console.log('⚠️ 리소스 정리 중 오류:', error.message);
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

