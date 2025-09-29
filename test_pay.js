const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class PaymentProcessor {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        // 환경 변수로 외부 브라우저 사용 여부 확인
        this.isExternalBrowser = process.env.USE_EXTERNAL_BROWSER === 'true';
    }

    // 브라우저 초기화
    async init() {
        try {
            console.log('🚀 브라우저 초기화 중...');
            
            // 다운로드 경로를 .playwright-mcp 폴더로 설정
            const downloadPath = path.join(__dirname, '.playwright-mcp');
            
            // .playwright-mcp 폴더가 없으면 생성
            if (!fs.existsSync(downloadPath)) {
                fs.mkdirSync(downloadPath, { recursive: true });
                console.log(`📁 .playwright-mcp 폴더 생성: ${downloadPath}`);
            }
            
            if (this.isExternalBrowser) {
                // 외부 브라우저 사용 (iros_finder.js에서 전달받은 브라우저)
                console.log('🔄 기존 브라우저를 사용합니다.');
                
                // 기존 페이지에 다운로드 이벤트 리스너 추가
                this.page.on('download', async (download) => {
                    const fileName = download.suggestedFilename();
                    const filePath = path.join(downloadPath, fileName);
                    await download.saveAs(filePath);
                    console.log(`📥 파일 다운로드 완료: ${fileName} -> ${filePath}`);
                });
                
            } else {
                // 새 브라우저 생성 (독립 실행 시)
                console.log('🆕 새 브라우저를 생성합니다.');
                
            this.browser = await chromium.launch({ 
                headless: false,
                    slowMo: 1000, // 1초 지연으로 동작 확인 가능
                    channel: 'chrome', // 실제 크롬 브라우저 사용
                    args: [
                        `--download-directory=${downloadPath}`,
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor'
                    ]
                });
                
                // 브라우저 컨텍스트 생성 시 다운로드 경로 설정
                this.context = await this.browser.newContext({
                    acceptDownloads: true,
                    downloadPath: downloadPath
                });
                
                // 컨텍스트에서 페이지 생성
                this.page = await this.context.newPage();
                
                // 다운로드 이벤트 리스너 추가
                this.page.on('download', async (download) => {
                    const fileName = download.suggestedFilename();
                    const filePath = path.join(downloadPath, fileName);
                    await download.saveAs(filePath);
                    console.log(`📥 파일 다운로드 완료: ${fileName} -> ${filePath}`);
                });
            }
            
            console.log(`📁 다운로드 경로 설정: ${downloadPath}`);
            
            // 현재 페이지가 IROS 사이트인지 확인
            const currentUrl = this.page.url();
            console.log(`🔍 현재 페이지 URL: ${currentUrl}`);
            
            if (currentUrl.includes('iros.go.kr')) {
                console.log('✅ 이미 IROS 사이트가 열려있습니다. 새로 이동하지 않습니다.');
            } else {
                // IROS 사이트로 이동
                console.log('🌐 IROS 사이트로 이동 중...');
                await this.page.goto('https://www.iros.go.kr');
                console.log('✅ IROS 사이트로 이동 완료');
            }
            
            console.log('✅ 브라우저 초기화 완료');
            
        } catch (error) {
            console.log('❌ 브라우저 초기화 실패:', error.message);
            throw error;
        }
    }

    // 브라우저 종료
    async close() {
        if (this.isExternalBrowser) {
            console.log('🔄 외부 브라우저를 사용 중이므로 종료하지 않습니다.');
            return;
        }
        
        if (this.context) {
            await this.context.close();
        }
        if (this.browser) {
            await this.browser.close();
            console.log('🔚 브라우저 종료 완료');
        }
    }

    // 대기 함수
    async waitWithTimeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 홈페이지로 이동하여 팝업 제거
    async goToHomePageAndRemovePopups() {
        try {
            // IROS 홈페이지로 이동
            console.log('🌐 IROS 홈페이지로 이동 중...');
            await this.page.goto('https://www.iros.go.kr');
            
            // 홈페이지 로딩 완료 대기
            console.log('⏳ 홈페이지 로딩 대기 중...');
            try {
                // 홈페이지의 주요 요소가 로드될 때까지 대기
                await this.page.waitForSelector('body', { timeout: 10000, state: 'visible' });
                console.log('✅ 홈페이지 로딩 완료');
            } catch (error) {
                console.log('⚠️ 홈페이지 로딩 확인 실패, 계속 진행');
            }
            
            await this.waitWithTimeout(2000); // 추가 안정화 대기
            
            // 팝업 제거 (iros_create.js 방식 적용)
            console.log('🔍 팝업 제거 시도 중...');
            
            try {
                // iros_create.js의 강력한 팝업 제거 로직 적용
                const removedCount = await this.page.evaluate(() => {
                    let removedCount = 0;
                    
                    // 모든 가능한 닫기 버튼들 찾기 (메뉴는 제외)
                    const closeButtons = document.querySelectorAll('button[title*="닫기"]:not([id*="menu"]):not([class*="menu"]), button[title*="close"]:not([id*="menu"]):not([class*="menu"]), [onclick*="close"]:not([id*="menu"]):not([class*="menu"]), .btn-close:not([id*="menu"]):not([class*="menu"]), .close-btn:not([id*="menu"]):not([class*="menu"]), [alt*="닫기"]:not([id*="menu"]):not([class*="menu"]), [alt*="close"]:not([id*="menu"]):not([class*="menu"])');
                    closeButtons.forEach(btn => {
                        // 메뉴 관련 요소인지 추가 확인
                        const isMenuElement = btn.id.includes('menu') || btn.id.includes('nav') || 
                                            btn.className.includes('menu') || btn.className.includes('nav') ||
                                            btn.closest('[id*="menu"]') || btn.closest('[class*="menu"]') ||
                                            btn.closest('[id*="nav"]') || btn.closest('[class*="nav"]');
                        
                        if (btn.offsetParent !== null && !isMenuElement) {
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
                    
                    // 팝업 요소들 숨기기 (메뉴는 제외하고 정확한 팝업만)
                    const popupElements = document.querySelectorAll('div[id*="popup"]:not([id*="menu"]):not([id*="nav"]), div[class*="popup"]:not([class*="menu"]):not([class*="nav"]), div[id*="layer"]:not([id*="menu"]):not([id*="nav"]), div[class*="layer"]:not([class*="menu"]):not([class*="nav"]), div[id*="modal"]:not([id*="menu"]):not([id*="nav"]), div[class*="modal"]:not([class*="menu"]):not([class*="nav"])');
                    popupElements.forEach(el => {
                        // 메뉴 관련 요소인지 추가 확인
                        const isMenuElement = el.id.includes('menu') || el.id.includes('nav') || 
                                            el.className.includes('menu') || el.className.includes('nav') ||
                                            el.closest('[id*="menu"]') || el.closest('[class*="menu"]') ||
                                            el.closest('[id*="nav"]') || el.closest('[class*="nav"]');
                        
                        if (el.offsetParent !== null && !isMenuElement) {
                            el.style.display = 'none';
                            removedCount++;
                        }
                    });
                    
                    // 추가 팝업 제거 시도 (메뉴는 제외)
                    const additionalSelectors = [
                        'button:has-text("닫기"):not([id*="menu"]):not([class*="menu"])',
                        'button:has-text("확인"):not([id*="menu"]):not([class*="menu"])',
                        'button:has-text("Close"):not([id*="menu"]):not([class*="menu"])',
                        'a:has-text("닫기"):not([id*="menu"]):not([class*="menu"])',
                        'a:has-text("확인"):not([id*="menu"]):not([class*="menu"])',
                        'a:has-text("Close"):not([id*="menu"]):not([class*="menu"])',
                        'input[type="button"][value="닫기"]:not([id*="menu"]):not([class*="menu"])',
                        'input[type="button"][value="확인"]:not([id*="menu"]):not([class*="menu"])'
                    ];
                    
                    additionalSelectors.forEach(selector => {
                        try {
                            const elements = document.querySelectorAll(selector);
                            elements.forEach(el => {
                                // 메뉴 관련 요소인지 추가 확인
                                const isMenuElement = el.id.includes('menu') || el.id.includes('nav') || 
                                                    el.className.includes('menu') || el.className.includes('nav') ||
                                                    el.closest('[id*="menu"]') || el.closest('[class*="menu"]') ||
                                                    el.closest('[id*="nav"]') || el.closest('[class*="nav"]');
                                
                                if (el.offsetParent !== null && !isMenuElement) {
                                    el.click();
                                    removedCount++;
                                }
                            });
                        } catch (e) {
                            // 선택자 오류 무시
                        }
                    });
                    
                    // ESC 키 시뮬레이션
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                    
                    return removedCount;
                });
                
                if (removedCount > 0) {
                    console.log(`✅ ${removedCount}개의 팝업/요소 제거됨`);
                } else {
                    console.log('ℹ️ 제거할 팝업이 없습니다.');
                }
                
            } catch (error) {
                console.log('⚠️ 팝업 제거 중 오류:', error.message);
            }
            
            console.log('✅ 홈페이지 이동 및 팝업 제거 완료');
            
        } catch (error) {
            console.log('❌ 홈페이지 이동 중 오류:', error.message);
        }
    }

    // 열람·발급 메뉴로 이동
    // 1단계: 첫 번째 "열람·발급" 메뉴 클릭 (상단 메뉴바)
    // 2단계: 법인 섹션의 "신청결과 확인 (미열람·미발급/재열람 등)" 클릭
    // 3단계: 하위 메뉴의 "열람·발급" 클릭하여 최종 페이지로 이동
    async navigateToViewIssueMenu() {
        try {
            // 1단계: 첫 번째 열람·발급 메뉴 클릭 (상단 메뉴바의 메인 메뉴)
            // 이 클릭으로 하위 메뉴들이 표시됩니다
            console.log('🔍 1단계: 첫 번째 열람·발급 메뉴 클릭 중...');
            
            // JavaScript를 사용한 직접 클릭 (더 안정적)
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
            await this.waitWithTimeout(2000);
            console.log('✅ 1단계 완료: 첫 번째 열람·발급 메뉴 클릭 완료');
            
        // 2단계: 법인 섹션의 "신청결과 확인 (미열람·미발급/재열람 등)" 링크 클릭
        // 부동산 섹션이 아닌 법인 섹션의 링크만 클릭해야 합니다
        console.log('🔍 2단계: 법인 섹션의 신청결과 확인 링크 클릭 중...');
        
        try {
            // JavaScript를 사용한 직접 클릭 (더 안정적)
            // 법인 섹션의 "신청결과 확인" 메뉴를 정확히 클릭
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
                        
                        // 상위 요소들을 확인하여 법인 섹션인지 판단
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
            await this.waitWithTimeout(3000);
            
        } catch (error) {
            console.log('⚠️ JavaScript 클릭 실패, 대체 방법 시도...');
            
            // 법인 섹션의 신청결과 확인 링크를 정확히 찾기
            // 부동산 섹션의 링크를 피하고 법인 섹션의 링크만 클릭
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
                    // 부모 요소를 확인하여 법인 섹션인지 판단
                    const parentText = await link.evaluate(el => {
                        const parent = el.closest('li');
                        return parent ? parent.textContent : '';
                    });
                    
                    console.log(`🔍 링크 ${i + 1} 부모 텍스트: "${parentText}"`);
                    
                    // 법인 섹션인지 확인 (부동산이 아닌)
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
            
            // 3단계: 하위 메뉴의 "열람·발급" 클릭하여 최종 페이지로 이동
            // 이 클릭으로 "법인 등기사항증명서 열람·발급 신청결과" 페이지로 이동합니다
            console.log('🔍 3단계: 하위 메뉴의 열람·발급 클릭 중...');
            
            // JavaScript를 사용한 직접 클릭 (더 안정적)
            const clickResult3 = await this.page.evaluate(() => {
                const targetElement = document.querySelector('#mf_wfm_potal_main_wf_header_gen_depth1_0_gen_depth2_1_gen_depth3_6_gen_depth4_0_btn_top_menu4');
                if (targetElement) {
                    targetElement.click();
                    return '열람·발급 메뉴 클릭 성공';
                } else {
                    return '열람·발급 메뉴를 찾을 수 없음';
                }
            });
            
            console.log(`📋 JavaScript 클릭 결과: ${clickResult3}`);
            await this.waitWithTimeout(3000);
            
            // 페이지 이동 확인
            const currentUrl = this.page.url();
            console.log(`🔍 현재 페이지 URL: ${currentUrl}`);
            
            if (currentUrl.includes('열람') || currentUrl.includes('발급')) {
                console.log('✅ 3단계 완료: 열람·발급 페이지로 이동 성공');
            } else {
                console.log('⚠️ 페이지 이동 확인 필요');
            }
            
            console.log('🎉 모든 네비게이션 단계 완료: 법인 등기사항증명서 열람·발급 신청결과 페이지 도달');
            
        } catch (error) {
            console.log('❌ 열람·발급 메뉴 이동 중 오류:', error.message);
            // 메뉴 클릭 실패 시 다른 방법 시도
            try {
                console.log('🔄 대체 방법으로 메뉴 이동 시도...');
                await this.page.goto('https://www.iros.go.kr/biz/Pc20VipRgsCtrl/callRgsList.do');
                await this.waitWithTimeout(3000);
                console.log('✅ 직접 URL로 이동 완료');
            } catch (directError) {
                console.log('❌ 직접 URL 이동도 실패:', directError.message);
            }
        }
    }

    // 결제 완료 후 열람/발급 자동화 (메인 함수)
    async processPaymentAndDownload() {
        try {
            console.log('\n💳 결제 완료 후 열람/발급 자동화를 시작합니다...');
            
            // 1. 홈페이지로 이동하여 팝업 제거
            console.log('🏠 홈페이지로 이동하여 팝업을 제거합니다...');
            await this.goToHomePageAndRemovePopups();
            
            // 2. 열람·발급 메뉴 클릭
            console.log('📋 열람·발급 메뉴로 이동합니다...');
            await this.navigateToViewIssueMenu();
            
            // 3. 결제 완료 확인 대기
            console.log('⏳ 결제 완료를 기다리는 중...');
            await this.waitForPaymentCompletion();
            
            // 4. 모든 등기에 대해 순차적으로 열람/발급 처리
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

    // 모든 등기에 대해 순차적으로 처리 (페이지네이션 포함)
    async processAllRegistrations() {
        try {
            let currentPage = 1;
            let hasMorePages = true;
            
            while (hasMorePages) {
                console.log(`\n📄 페이지 ${currentPage} 처리 시작...`);
                
                // 현재 페이지의 모든 등기 처리
                const hasMoreOnCurrentPage = await this.processCurrentPage();
                
                if (hasMoreOnCurrentPage) {
                    // 다음 페이지로 이동
                    const nextPageResult = await this.goToNextPage();
                    if (nextPageResult) {
                        currentPage++;
                        await this.waitWithTimeout(2000); // 페이지 로딩 대기
                    } else {
                        console.log('📄 더 이상 페이지가 없습니다. 처리 완료!');
                        hasMorePages = false;
                    }
                } else {
                    console.log('📄 현재 페이지에 처리할 등기가 없습니다.');
                    hasMorePages = false;
                }
            }
            
        } catch (error) {
            console.log('❌ 등기 처리 중 오류:', error.message);
        }
    }

    // 현재 페이지의 모든 등기 처리
    async processCurrentPage() {
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
                    
                    // 다음 등기 처리 전 잠시 대기
                    await this.waitWithTimeout(1000);
                } else {
                    console.log('📋 현재 페이지에서 더 이상 처리할 등기가 없습니다.');
                    hasMoreRegistrations = false;
                }
            }
            
            return registrationIndex > 0; // 처리된 등기가 있으면 true
            
        } catch (error) {
            console.log('❌ 현재 페이지 처리 중 오류:', error.message);
            return false;
        }
    }

    // 다음 페이지로 이동
    async goToNextPage() {
        try {
            console.log('➡️ 다음 페이지로 이동 중...');
            
            // 다음 페이지 버튼 찾기
            const nextPageButton = await this.page.waitForSelector(
                'img[alt="다음 페이지"]', 
                { timeout: 5000 }
            );
            
            if (nextPageButton) {
                // 현재 페이지 번호 저장
                const currentPageElement = await this.page.$('.paging .current');
                const currentPageText = currentPageElement ? await currentPageElement.textContent() : '1';
                
                await nextPageButton.click();
                await this.waitWithTimeout(3000); // 페이지 로딩 대기
                
                // 페이지가 실제로 변경되었는지 확인
                const newPageElement = await this.page.$('.paging .current');
                const newPageText = newPageElement ? await newPageElement.textContent() : '1';
                
                if (newPageText !== currentPageText) {
                    console.log(`✅ 페이지 ${currentPageText} → ${newPageText} 이동 완료`);
                    return true;
                } else {
                    console.log('❌ 페이지가 변경되지 않았습니다. 마지막 페이지입니다.');
                    return false;
                }
            } else {
                console.log('❌ 다음 페이지 버튼을 찾을 수 없습니다.');
                return false;
            }
            
        } catch (error) {
            console.log('❌ 다음 페이지 이동 중 오류:', error.message);
            return false;
        }
    }

    // 열람 버튼 찾기 및 클릭 (항상 첫 번째 열람 버튼 클릭)
    async findAndClickViewButton(index) {
        try {
            console.log(`🔍 열람 버튼 ${index + 1} 찾는 중...`);
            
            // 실제 테스트에서 확인된 정확한 선택자 사용
            const viewButtons = await this.page.locator('button:has-text("열람")').all();
            console.log(`📋 찾은 열람 버튼 개수: ${viewButtons.length}`);
            
            if (viewButtons && viewButtons.length > 0) {
                // 항상 첫 번째 열람 버튼 클릭 (DOM 변경으로 인한 인덱스 문제 해결)
                console.log(`🔍 첫 번째 열람 버튼 클릭 중... (등기 ${index + 1} 처리)`);
                await viewButtons[0].click();
                await this.waitWithTimeout(2000);
                
                // 확인 대화상자 처리
                await this.handleConfirmationDialog();
                
                return true;
            } else {
                console.log(`❌ 열람 버튼을 찾을 수 없습니다. (총 ${viewButtons.length}개 발견)`);
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
            console.log('🔍 확인 대화상자 찾는 중...');
            
            // 여러 가지 방법으로 확인 버튼 찾기 시도
            let confirmButton = null;
            
            // 방법 1: 정확한 팝업 창 내부의 확인 버튼 찾기
            try {
                // 팝업 창 내부의 type2 그룹에서 확인 버튼 찾기
                confirmButton = await this.page.waitForSelector('div[id*="message_popup"][id*="wframe_grp_type2"] a[id*="btn_confirm2"]', { 
                    timeout: 3000,
                    state: 'visible'
                });
                console.log('✅ 팝업 창 type2 그룹의 확인 버튼 찾음');
            } catch (error) {
                console.log('⚠️ 팝업 창 type2 그룹의 확인 버튼 찾을 수 없음');
            }
            
            // 방법 1-1: XPath로 정확한 ID 찾기 (동적 ID 패턴)
            if (!confirmButton) {
                try {
                    // 동적 ID 패턴으로 확인 버튼 찾기
                    confirmButton = await this.page.waitForSelector('xpath=//a[contains(@id, "wframe_btn_confirm") and contains(text(), "확인")]', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ XPath로 동적 ID 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ XPath로 동적 ID 확인 버튼 찾을 수 없음');
                }
            }
            
            // 방법 1-1: 모달 팝업 내부의 확인 버튼 찾기
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('#_modal a:has-text("확인")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ #_modal a:has-text("확인") 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ #_modal a:has-text("확인") 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 1-1: 모달 팝업 내부의 확인 버튼 (클래스 기반)
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('#_modal a.w2anchor2.btn:has-text("확인")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ #_modal a.w2anchor2.btn:has-text("확인") 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ #_modal a.w2anchor2.btn:has-text("확인") 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 1-2: link:has-text("확인") (MCP 테스트에서 성공한 방법)
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
            
            // 방법 1-2: 실제 HTML 구조에 맞는 선택자 (class 기반)
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('a.w2anchor2.btn:has-text("확인")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ a.w2anchor2.btn:has-text("확인") 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ a.w2anchor2.btn:has-text("확인") 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 1-3: href 속성 기반 선택자
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('a[href="javascript:void(null);"]:has-text("확인")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ a[href="javascript:void(null);"]:has-text("확인") 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ a[href="javascript:void(null);"]:has-text("확인") 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 2: button:has-text("확인")
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
            
            // 방법 3: input[type="button"][value="확인"]
            if (!confirmButton) {
                try {
                    confirmButton = await this.page.waitForSelector('input[type="button"][value="확인"]', { 
                        timeout: 3000,
                state: 'visible'
                    });
                    console.log('✅ input[type="button"][value="확인"] 선택자로 확인 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ input[type="button"][value="확인"] 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 4: 모든 버튼과 링크 확인
            if (!confirmButton) {
                try {
                    const allButtons = await this.page.locator('button, link, input[type="button"]').all();
                    console.log(`📋 페이지의 전체 버튼/링크 개수: ${allButtons.length}`);
                    
                    for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
                        const buttonText = await allButtons[i].textContent();
                        const buttonValue = await allButtons[i].getAttribute('value');
                        const buttonType = await allButtons[i].tagName();
                        console.log(`   요소 ${i + 1}: 태그="${buttonType}", 텍스트="${buttonText}", value="${buttonValue}"`);
                        
                        if (buttonText && buttonText.includes('확인')) {
                            confirmButton = allButtons[i];
                            console.log(`✅ 텍스트로 확인 버튼 찾음: "${buttonText}"`);
                            break;
                        }
                        if (buttonValue && buttonValue.includes('확인')) {
                            confirmButton = allButtons[i];
                            console.log(`✅ value로 확인 버튼 찾음: "${buttonValue}"`);
                            break;
                        }
                    }
                } catch (error) {
                    console.log('⚠️ 버튼 정보를 가져올 수 없습니다.');
                }
            }
            
            if (confirmButton) {
                console.log('⚠️ 확인 대화상자가 나타났습니다. "확인" 버튼을 클릭합니다.');
                
                // 여러 가지 클릭 방법 시도
                let clickSuccess = false;
                
                // 방법 1: 일반 클릭 (화면 고정)
                try {
                    // 화면 스크롤 방지
                    await this.page.evaluate(() => {
                        document.body.style.overflow = 'hidden';
                    });
                    
                    // 요소가 화면에 보이도록 스크롤
                    await confirmButton.scrollIntoViewIfNeeded();
                    
                    // 잠시 대기 (화면 안정화)
                    await this.waitWithTimeout(500);
                    
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
                
                // 방법 3: JavaScript로 클릭 (모달 우회)
                if (!clickSuccess) {
                    try {
                        await confirmButton.evaluate(element => {
                            // 모달을 우회해서 클릭
                            element.click();
                        });
                        console.log('✅ JavaScript 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ JavaScript 클릭 실패:', error.message);
                    }
                }
                
                // 방법 3-1: 팝업 창 내부에서 직접 클릭 (화면 고정)
                if (!clickSuccess) {
                    try {
                        await this.page.evaluate(() => {
                            // 화면 스크롤 방지
                            document.body.style.overflow = 'hidden';
                            
                            // 팝업 창 내부의 type2 그룹에서 확인 버튼 찾기
                            const popupWindow = document.querySelector('div[id*="message_popup"]');
                            if (popupWindow) {
                                const type2Group = popupWindow.querySelector('div[id*="wframe_grp_type2"]');
                                if (type2Group && type2Group.style.display !== 'none') {
                                    const confirmBtn = type2Group.querySelector('a[id*="btn_confirm2"]');
                                    if (confirmBtn) {
                                        // 요소가 화면에 보이도록 스크롤
                                        confirmBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
                                        
                                        // 잠시 대기 후 클릭
                                        setTimeout(() => {
                                            confirmBtn.click();
                                        }, 100);
                                    }
                                }
                            }
                        });
                        console.log('✅ 팝업 창 내부 JavaScript 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ 팝업 창 내부 JavaScript 클릭 실패:', error.message);
                    }
                }
                
                // 방법 4: 좌표로 클릭
                if (!clickSuccess) {
                    try {
                        const box = await confirmButton.boundingBox();
                        if (box) {
                            await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                            console.log('✅ 좌표 클릭 성공');
                            clickSuccess = true;
                        }
                    } catch (error) {
                        console.log('⚠️ 좌표 클릭 실패:', error.message);
                    }
                }
                
                if (clickSuccess) {
                console.log('✅ 확인 대화상자 처리 완료');
                await this.waitWithTimeout(2000); // 처리 완료 대기
                } else {
                    console.log('❌ 모든 클릭 방법이 실패했습니다.');
                }
            } else {
                console.log('ℹ️ 확인 대화상자가 없습니다. 계속 진행합니다.');
            }
            
        } catch (error) {
            console.log('❌ 확인 대화상자 처리 중 오류:', error.message);
        }
    }

    // 열람 창 처리
    async handleViewWindow() {
        try {
            console.log('📄 열람 창에서 처리 중...');
            
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
            
            // 방법 1: 간단한 팝업 창 대기 (클래스만으로)
            try {
                await this.page.waitForSelector('div.w2window.w2popup_window', { 
                    timeout: 10000,
                    state: 'visible'
                });
                console.log('✅ 열람 창 팝업 확인됨 (w2popup_window)');
            } catch (error) {
                console.log('⚠️ w2popup_window 찾기 실패, 다른 방법 시도');
            }
            
            // 방법 2: iframe 대기 (더 간단한 선택자)
            try {
                await this.page.waitForSelector('iframe[title="ifm_pdf_wframe"]', { 
                    timeout: 10000,
                    state: 'visible'
                });
                console.log('✅ PDF iframe 확인됨 (title 기반)');
            } catch (error) {
                console.log('⚠️ iframe title 기반 찾기 실패, ID 기반 시도');
                // 백업: ID 패턴으로 iframe 찾기
                await this.page.waitForSelector('iframe[id*="ifm_pdf_wframe"]', { 
                    timeout: 10000,
                    state: 'visible'
                });
                console.log('✅ PDF iframe 확인됨 (ID 기반)');
            }
            
            // 방법 3: 저장 버튼 대기 (더 간단한 선택자)
            try {
                await this.page.waitForSelector('input[value="저장"]', { 
                    timeout: 10000,
                    state: 'visible'
                });
                console.log('✅ 저장 버튼 확인됨 - 열람 창 로딩 완료');
            } catch (error) {
                console.log('⚠️ 저장 버튼 찾기 실패, 다른 방법 시도');
                // 백업: button 태그로 찾기
                await this.page.waitForSelector('button:has-text("저장")', { 
                    timeout: 10000,
                state: 'visible'
            });
                console.log('✅ 저장 버튼 확인됨 (button 태그)');
            }
            
            // 추가 안정화 대기
            await this.waitWithTimeout(2000);
            
        } catch (error) {
            console.log('⚠️ 열람 창 로딩 대기 중 오류:', error.message);
            console.log('ℹ️ 로딩 실패해도 계속 진행합니다.');
            // 로딩 실패해도 계속 진행
        }
    }

    // 저장 버튼 클릭
    async clickDownloadButton() {
        try {
            console.log('💾 열람 창의 저장 버튼 클릭 중...');
            
            // 여러 가지 방법으로 저장 버튼 찾기 시도
            let downloadButton = null;
            
            // 방법 1: 정확한 팝업 창 내부의 저장 버튼 찾기
            try {
                downloadButton = await this.page.waitForSelector('div[id*="popup"] input[id*="btn_download"]', { 
                    timeout: 3000,
                    state: 'visible'
                });
                console.log('✅ 팝업 창 내부의 저장 버튼 찾음');
            } catch (error) {
                console.log('⚠️ 팝업 창 내부의 저장 버튼 찾을 수 없음');
            }
            
            // 방법 2: input[type="button"][value="저장"]
            if (!downloadButton) {
                try {
                    downloadButton = await this.page.waitForSelector('input[type="button"][value="저장"]', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ input[type="button"][value="저장"] 선택자로 저장 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ input[type="button"][value="저장"] 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 3: 클래스 기반 선택자
            if (!downloadButton) {
                try {
                    downloadButton = await this.page.waitForSelector('input.w2trigger.btn.medium[value="저장"]', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ 클래스 기반 선택자로 저장 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ 클래스 기반 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 4: button:has-text("저장")
            if (!downloadButton) {
                try {
                    downloadButton = await this.page.waitForSelector('button:has-text("저장")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ button:has-text("저장") 선택자로 저장 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ button:has-text("저장") 선택자로 찾을 수 없음');
                }
            }
            
            if (downloadButton) {
                console.log('✅ 저장 버튼을 찾았습니다. 클릭합니다.');
                
                // 여러 가지 클릭 방법 시도
                let clickSuccess = false;
                
                // 방법 1: 일반 클릭
                try {
                await downloadButton.click();
                    console.log('✅ 일반 클릭 성공');
                    clickSuccess = true;
                } catch (error) {
                    console.log('⚠️ 일반 클릭 실패:', error.message);
                }
                
                // 방법 2: force 옵션으로 클릭
                if (!clickSuccess) {
                    try {
                        await downloadButton.click({ force: true });
                        console.log('✅ force 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ force 클릭 실패:', error.message);
                    }
                }
                
                // 방법 3: JavaScript로 클릭
                if (!clickSuccess) {
                    try {
                        await downloadButton.evaluate(element => element.click());
                        console.log('✅ JavaScript 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ JavaScript 클릭 실패:', error.message);
                    }
                }
                
                // 방법 4: 팝업 창 내부에서 직접 클릭
                if (!clickSuccess) {
                    try {
                        await this.page.evaluate(() => {
                            // 팝업 창 내부의 저장 버튼 찾기
                            const popupWindow = document.querySelector('div[id*="popup"]');
                            if (popupWindow) {
                                const downloadBtn = popupWindow.querySelector('input[type="button"][value="저장"]');
                                if (downloadBtn) {
                                    downloadBtn.click();
                                }
                            }
                        });
                        console.log('✅ 팝업 창 내부 JavaScript 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ 팝업 창 내부 JavaScript 클릭 실패:', error.message);
                    }
                }
                
                if (clickSuccess) {
                    console.log('✅ 저장 버튼 클릭 완료 - PDF 다운로드 시작');
                await this.waitWithTimeout(3000); // 다운로드 완료 대기
                    return true;
                } else {
                    console.log('❌ 모든 클릭 방법이 실패했습니다.');
                    return false;
                }
            } else {
                console.log('❌ 저장 버튼을 찾을 수 없습니다.');
                return false;
            }
            
        } catch (error) {
            console.log('❌ 저장 버튼 클릭 중 오류:', error.message);
            return false;
        }
    }

    // 닫기 버튼 클릭
    async closeViewWindow() {
        try {
            console.log('❌ 열람 창 닫기 버튼 클릭 중...');
            
            // 여러 가지 방법으로 닫기 버튼 찾기 시도
            let closeButton = null;
            
            // 방법 1: 정확한 팝업 창 하단의 닫기 버튼 찾기
            try {
                closeButton = await this.page.waitForSelector('div[id*="popup"] input[id*="btn_close"]', { 
                    timeout: 3000,
                    state: 'visible'
                });
                console.log('✅ 팝업 창 하단의 닫기 버튼 찾음');
            } catch (error) {
                console.log('⚠️ 팝업 창 하단의 닫기 버튼 찾을 수 없음');
            }
            
            // 방법 1-1: 팝업 창 헤더의 닫기 버튼 찾기 (백업)
            if (!closeButton) {
                try {
                    closeButton = await this.page.waitForSelector('div[id*="popup"] a[id*="_close"]', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ 팝업 창 헤더의 닫기 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ 팝업 창 헤더의 닫기 버튼 찾을 수 없음');
                }
            }
            
            // 방법 2: 클래스 기반 선택자 (w2window_close)
            if (!closeButton) {
                try {
                    closeButton = await this.page.waitForSelector('a.w2window_close.w2window_close_atag', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ 클래스 기반 닫기 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ 클래스 기반 닫기 버튼 찾을 수 없음');
                }
            }
            
            // 방법 3: input[type="button"][value="닫기"]
            if (!closeButton) {
                try {
                    closeButton = await this.page.waitForSelector('input[type="button"][value="닫기"]', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ input[type="button"][value="닫기"] 선택자로 닫기 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ input[type="button"][value="닫기"] 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 4: button:has-text("닫기")
            if (!closeButton) {
                try {
                    closeButton = await this.page.waitForSelector('button:has-text("닫기")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ button:has-text("닫기") 선택자로 닫기 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ button:has-text("닫기") 선택자로 찾을 수 없음');
                }
            }
            
            // 방법 5: a:has-text("창닫기")
            if (!closeButton) {
                try {
                    closeButton = await this.page.waitForSelector('a:has-text("창닫기")', { 
                        timeout: 3000,
                        state: 'visible'
                    });
                    console.log('✅ a:has-text("창닫기") 선택자로 닫기 버튼 찾음');
                } catch (error) {
                    console.log('⚠️ a:has-text("창닫기") 선택자로 찾을 수 없음');
                }
            }
            
            if (closeButton) {
                console.log('✅ 닫기 버튼을 찾았습니다. 클릭합니다.');
                
                // 여러 가지 클릭 방법 시도
                let clickSuccess = false;
                
                // 방법 1: 일반 클릭
                try {
                    await closeButton.click();
                    console.log('✅ 일반 클릭 성공');
                    clickSuccess = true;
                } catch (error) {
                    console.log('⚠️ 일반 클릭 실패:', error.message);
                }
                
                // 방법 2: force 옵션으로 클릭
                if (!clickSuccess) {
                    try {
                        await closeButton.click({ force: true });
                        console.log('✅ force 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ force 클릭 실패:', error.message);
                    }
                }
                
                // 방법 3: JavaScript로 클릭
                if (!clickSuccess) {
                    try {
                        await closeButton.evaluate(element => element.click());
                        console.log('✅ JavaScript 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ JavaScript 클릭 실패:', error.message);
                    }
                }
                
                // 방법 4: 팝업 창 내부에서 직접 클릭
                if (!clickSuccess) {
                    try {
                        await this.page.evaluate(() => {
                            // 팝업 창 내부의 닫기 버튼 찾기 (하단 버튼 우선)
                            const popupWindow = document.querySelector('div[id*="popup"]');
                            if (popupWindow) {
                                // 하단의 input 닫기 버튼 찾기
                                const closeBtn = popupWindow.querySelector('input[id*="btn_close"]') ||
                                               popupWindow.querySelector('a[id*="_close"]') ||
                                               popupWindow.querySelector('a.w2window_close');
                                if (closeBtn) {
                                    closeBtn.click();
                                }
                            }
                        });
                        console.log('✅ 팝업 창 내부 JavaScript 클릭 성공');
                        clickSuccess = true;
                    } catch (error) {
                        console.log('⚠️ 팝업 창 내부 JavaScript 클릭 실패:', error.message);
                    }
                }
                
                if (clickSuccess) {
                    console.log('✅ 닫기 버튼 클릭 완료 - 열람 창 닫힘');
                    await this.waitWithTimeout(2000); // 창 닫힘 대기
                    return true;
                } else {
                    console.log('❌ 모든 클릭 방법이 실패했습니다.');
                    return false;
                }
            } else {
                console.log('❌ 닫기 버튼을 찾을 수 없습니다.');
                return false;
            }
            
        } catch (error) {
            console.log('❌ 닫기 버튼 클릭 중 오류:', error.message);
            return false;
        }
    }

    // change.py 실행
    async runChangePy() {
        try {
            console.log('🐍 change.py 실행 중...');
            
            // change.py 파일 경로 (현재 디렉토리의 change.py)
            const changePyPath = path.join(__dirname, 'change.py');
            
            return new Promise((resolve, reject) => {
                const pythonProcess = spawn('python', [`"${changePyPath}"`], {
                    stdio: ['pipe', 'inherit', 'inherit'], // stdin을 pipe로 설정
                    shell: true
                });
                
                // 자동으로 "1" 입력 (자동 파일명 변경 선택)
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


    // 사용자 입력 대기
    async askQuestion(question) {
        return new Promise((resolve) => {
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }
}

// 메인 실행 함수
async function main() {
    const processor = new PaymentProcessor();
    
    try {
        // 브라우저 초기화
        await processor.init();
        
        // 사용자에게 페이지 이동 안내
        console.log('\n📋 안내사항:');
        console.log('1. 브라우저에서 IROS 사이트에 로그인하세요');
        console.log('2. 결제 완료 후 등기 목록이 보이는 페이지로 이동하세요');
        console.log('3. 준비가 되면 Enter를 눌러주세요');
        console.log('💡 IROS 사이트가 이미 열려있습니다!');
        
        await processor.askQuestion('\n준비가 되셨나요? (Enter를 눌러주세요): ');
        
        // 결제 후 처리 시작
        await processor.processPaymentAndDownload();
        
    } catch (error) {
        console.log('❌ 실행 중 오류 발생:', error.message);
    } finally {
        // 브라우저 종료
        await processor.close();
    }
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (require.main === module) {
    main().catch(console.error);
}

module.exports = PaymentProcessor;
