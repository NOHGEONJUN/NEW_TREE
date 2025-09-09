const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline'); // 사용자 입력을 위한 readline 모듈 추가

class IROSAutomation {
    constructor() {
        this.browser = null;
        this.page = null;
        this.processedCompanies = [];
        this.failedCompanies = [];
        // readline 인터페이스 초기화
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    // 사용자 입력을 받는 함수
    async askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
        });
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
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // 4단계: 페이지 완전 로딩 대기
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(3000); // 추가 로딩 시간
        
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
        await this.page.waitForTimeout(2000);
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
        // 비대화형 모드: 환경 변수로 로그인 확인 스킵
        if ((process.env.IROS_AUTO_CONFIRM_LOGIN || '').toLowerCase() === 'yes' || (process.env.IROS_AUTO_CONFIRM_LOGIN || '').toLowerCase() === 'y' || process.env.IROS_AUTO_CONFIRM_LOGIN === '1') {
            console.log('🔑 (ENV) 로그인 완료로 간주합니다.');
            return;
        }

        console.log('🔑 IROS 사이트에 로그인해주세요...');
        console.log('💡 로그인 후 아래 메시지에 "완료" 또는 "y"를 입력하세요.');
        
        while (true) {
            const answer = await this.askQuestion('로그인이 완료되었나요? (완료/y/yes): ');
            
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
        
        console.log(`✅ ${removedCount}개의 광고/배너/팝업이 제거되었습니다.`);
    }

    async handlePaymentPopup() {
        console.log('🧾 결제 팝업 확인...');
        try {
            // 팝업 메시지 존재 여부 확인
            const popupTextCount = await this.page.getByText('결제할 등기사항증명서가 존재합니다', { exact: false }).count();
            if (popupTextCount > 0) {
                const cancelLink = this.page.getByRole('link', { name: '취소' }).first();
                try {
                    if (await cancelLink.isVisible()) {
                        await cancelLink.click();
                        await this.page.waitForTimeout(500);
                        console.log('✅ 결제 팝업 "취소" 클릭 완료');
                        return;
                    }
                } catch (_) { /* fallthrough */ }
                // 취소 버튼이 보이지 않으면 ESC로 닫기 시도
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(300);
                console.log('✅ 결제 팝업 ESC로 닫기 시도');
            } else {
                console.log('ℹ️ 결제 팝업이 감지되지 않았습니다.');
            }
        } catch (e) {
            console.log('⚠️ 결제 팝업 처리 중 예외:', e.message);
        }
    }

    async navigateToSearch() {
        console.log('🔍 법인 검색 페이지로 이동 중...');
        
        // 메인 페이지에서 법인 열람·발급 버튼 클릭
        await this.page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const corporationLink = links.find(link => 
                link.textContent && link.textContent.includes('법인 열람·발급')
            );
            if (corporationLink) {
                corporationLink.click();
                return true;
            }
            return false;
        });
        
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        
        // 결제 팝업이 있으면 취소 클릭
        await this.handlePaymentPopup();
        
        console.log('✅ 법인 검색 페이지 도달');
    }

    async setupSearchFilters() {
        console.log('⚙️ 검색 필터 설정 중...');
        // 페이지 진입 시 결제 팝업이 떠있으면 우선 닫기
        await this.handlePaymentPopup();
        
        try {
            // 등기소: "전체등기소"
            await this.page.getByLabel('등기소').selectOption({ label: '전체등기소' });
            console.log('✅ 등기소: 전체등기소 설정');
            
            // 법인구분: "전체 법인(지배인, 미성년자, 법정대리인 제외)"
            await this.page.getByLabel('법인구분').selectOption({ label: '전체 법인(지배인, 미성년자, 법정대리인 제외)' });
            console.log('✅ 법인구분: 전체 법인 설정');
            
            // 등기부상태: "살아있는 등기"
            await this.page.getByLabel('등기부상태').selectOption({ label: '살아있는 등기' });
            console.log('✅ 등기부상태: 살아있는 등기 설정');
            
            // 본지점구분은 기본값 유지(전체 본지점)
            console.log('✅ 본지점구분: 전체 본지점 (기본값 유지)');
            
            await this.page.waitForTimeout(500);
        } catch (error) {
            console.log('⚠️ 검색 필터 설정 중 오류 발생:', error.message);
        }
    }

    async searchCompany(companyName, retryCount = 0) {
        console.log(`🔍 "${companyName}" 검색 중... (시도 ${retryCount + 1}/3)`);
        
        try {
            // 등기상호 입력 필드에 회사명 입력 (ref e7755 기반)
            let inputSuccess = false;
            
            // 방법 1: ref 기반 정확한 selector
            try {
                await this.page.locator('input[name="resCompNm"], input[id*="compNm"], input.form-control:has-text("")').last().fill(companyName);
                inputSuccess = true;
                console.log('✅ 등기상호 입력 성공 (방법 1)');
            } catch (e1) {
                console.log('⚠️ 방법 1 실패, 방법 2 시도...');
                
                // 방법 2: JavaScript로 직접 입력
                try {
                    await this.page.evaluate((name) => {
                        // ref e7755에 해당하는 입력 필드를 찾기
                        const inputs = document.querySelectorAll('input[type="text"]');
                        const companyInput = Array.from(inputs).find(input => 
                            input.placeholder && (
                                input.placeholder.includes('등기상호') || 
                                input.placeholder.includes('상호') ||
                                input.name && input.name.includes('compNm')
                            )
                        );
                        
                        if (companyInput) {
                            companyInput.value = name;
                            companyInput.dispatchEvent(new Event('input', { bubbles: true }));
                            companyInput.dispatchEvent(new Event('change', { bubbles: true }));
                            companyInput.focus();
                            return true;
                        }
                        
                        // 마지막 텍스트 입력 필드를 시도
                        const lastInput = inputs[inputs.length - 1];
                        if (lastInput) {
                            lastInput.value = name;
                            lastInput.dispatchEvent(new Event('input', { bubbles: true }));
                            lastInput.dispatchEvent(new Event('change', { bubbles: true }));
                            lastInput.focus();
                            return true;
                        }
                        
                        return false;
                    }, companyName);
                    
                    inputSuccess = true;
                    console.log('✅ 등기상호 입력 성공 (방법 2 - JavaScript)');
                } catch (e2) {
                    console.log('❌ 등기상호 입력 실패:', e2.message);
                }
            }
            
            if (!inputSuccess) {
                throw new Error('등기상호 입력 필드를 찾을 수 없습니다');
            }
            
            await this.page.waitForTimeout(1000);
            
            // 검색 버튼 클릭
            try {
                await this.page.getByRole('link', { name: '검색' }).click();
            } catch (e) {
                // 대안: 모든 검색 버튼 시도
                await this.page.click('a:has-text("검색"), button:has-text("검색"), input[value="검색"]');
            }
            
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(3000);
            
            console.log(`✅ "${companyName}" 검색 완료`);
            
        } catch (error) {
            console.log(`❌ "${companyName}" 검색 실패:`, error.message);
            
            // 재시도 로직 (최대 3회)
            if (retryCount < 2) {
                console.log(`🔄 F5 새로고침 후 "${companyName}" 재시도...`);
                
                // F5 새로고침
                await this.page.reload({ waitUntil: 'networkidle' });
                await this.page.waitForTimeout(3000);
                
                // 검색 필터 다시 설정
                await this.setupSearchFilters();
                
                // 재귀 호출로 재시도
                return await this.searchCompany(companyName, retryCount + 1);
            } else {
                console.log(`❌ "${companyName}" 최종 실패 - 3회 시도 모두 실패`);
                throw error;
            }
        }
    }

    async selectCompanyAndProceed() {
        console.log('📋 검색 결과에서 첫 번째 회사 선택...');
        
        // 검색 결과가 여러 개인 경우 다음 버튼 클릭
        try {
            await this.page.click('link:has-text("다음")');
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
        } catch (e) {
            console.log('다음 버튼 없음 또는 단일 결과, 계속 진행...');
        }
        
        console.log('✅ 회사 선택 완료');
    }

    async setIssuanceOptions() {
        console.log('📝 발급 옵션 설정 중...');
        
        // 발급(출력) 라디오 버튼 선택 (사용자 제공 JavaScript 사용)
        await this.page.evaluate(() => {
            const issueRadio = document.querySelector('input[type="radio"][data-index="1"]');
            if (issueRadio) {
                issueRadio.click();
                return "✅ 발급(출력) 옵션이 성공적으로 선택되었습니다.";
            }
            return "❌ 발급(출력) 라디오 버튼을 찾을 수 없습니다.";
        });
        
        await this.page.waitForTimeout(1000);
        
        // 다음 버튼 클릭
        await this.page.click('link:has-text("다음")');
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        
        console.log('✅ 발급 옵션 설정 완료 (서면발급, 전부, 유효부분만)');
    }

    async selectRegistryItems() {
        console.log('📋 등기 항목 선택 중...');
        
        // 모든 필요한 체크박스 선택 (사용자 요청에 따라 모든 체크박스)
        await this.page.evaluate(() => {
            // 모든 체크박스 찾기
            const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
            let checkedCount = 0;
            
            allCheckboxes.forEach(checkbox => {
                if (!checkbox.checked) {
                    checkbox.click();
                    checkedCount++;
                }
            });
            
            // 특별히 지점/분사무소와 지배인/대리인 확인 (사용자 제공 코드 기반)
            const branchCheckbox = document.querySelector('input[data-rowindex="14"]');
            if (branchCheckbox && !branchCheckbox.checked) {
                branchCheckbox.click();
                console.log('✅ 지점/분사무소 체크박스 선택됨');
            }
            
            const managerCheckbox = document.querySelector('input[data-rowindex="15"]');
            if (managerCheckbox && !managerCheckbox.checked) {
                managerCheckbox.click();
                console.log('✅ 지배인/대리인 체크박스 선택됨');
            }
            
            return `✅ ${checkedCount}개의 체크박스가 선택되었습니다.`;
        });
        
        await this.page.waitForTimeout(1000);
        
        // 다음 버튼 클릭
        await this.page.click('link:has-text("다음")');
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        
        console.log('✅ 등기 항목 선택 완료 (모든 필요 항목 선택)');
    }

    async setPrivacyOption() {
        console.log('🔒 주민등록번호 공개여부 설정 중...');
        
        // "미공개" 옵션이 기본 선택되어 있으므로 바로 다음으로
        await this.page.click('link:has-text("다음")');
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        
        console.log('✅ 주민등록번호 미공개 설정 완료');
    }

    async finalConfirmation() {
        console.log('✅ 최종 확인 및 결제 페이지로 이동 중...');
        
        // 최종 확인 후 다음 클릭
        await this.page.waitForTimeout(2000);
        await this.page.click('link:has-text("다음")');
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(3000);
        
        console.log('✅ 결제 페이지 도달 완료');
    }

    async processCompany(companyName, isFirst = true, retryCount = 0) {
        console.log(`\n🏢 ===== "${companyName}" 처리 시작 (시도 ${retryCount + 1}/3) =====`);
        
        try {
            if (!isFirst) {
                console.log('➕ 추가 버튼 클릭...');
                await this.page.click('link:has-text("추가")');
                await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(2000);
                
                // 추가 후 다시 필터 설정
                await this.setupSearchFilters();
            }

            await this.searchCompany(companyName);
            await this.selectCompanyAndProceed();
            await this.setIssuanceOptions();
            await this.selectRegistryItems();
            await this.setPrivacyOption();
            await this.finalConfirmation();
            
            this.processedCompanies.push(companyName);
            console.log(`✅ "${companyName}" 처리 완료 - 결제 페이지 도달`);
            return true;
            
        } catch (error) {
            console.error(`❌ "${companyName}" 처리 실패: ${error.message}`);
            
            // 재시도 로직 (최대 3회)
            if (retryCount < 2) {
                console.log(`🔄 F5 새로고침 후 "${companyName}" 재시도... (${retryCount + 2}/3)`);
                
                // F5 새로고침
                await this.page.keyboard.press('F5');
                await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(3000);
                
                // 검색 페이지로 다시 이동
                try {
                    await this.navigateToSearch();
                    await this.setupSearchFilters();
                } catch (navError) {
                    console.log('⚠️ 검색 페이지 복귀 중 오류, 다시 시도...');
                    await this.page.reload({ waitUntil: 'networkidle' });
                    await this.page.waitForTimeout(3000);
                    await this.navigateToSearch();
                    await this.setupSearchFilters();
                }
                
                // 재귀 호출로 재시도
                return await this.processCompany(companyName, isFirst, retryCount + 1);
            } else {
                console.log(`❌ "${companyName}" 최종 실패 - 3회 시도 모두 실패`);
                this.failedCompanies.push({ company: companyName, error: error.message });
                console.log(`⚠️ "${companyName}" 처리를 포기하고 다음 회사로 넘어가지 않습니다.`);
                console.log('💡 문제를 해결한 후 다시 실행해주세요.');
                throw error; // 실패한 회사에서 전체 작업 중단
            }
        }
    }

    async processMultipleCompanies(companies, batchSize = 10) {
        console.log(`\n📊 총 ${companies.length}개 회사 처리 시작 (배치 크기: ${batchSize})`);
        
        for (let i = 0; i < companies.length; i += batchSize) {
            const batch = companies.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(companies.length / batchSize);
            
            console.log(`\n🎯 배치 ${batchNumber}/${totalBatches} 처리 중 (${batch.length}개 회사)`);
            console.log(`📋 현재 배치: ${batch.join(', ')}`);
            
            // 첫 번째 회사부터 순차 처리
            for (let j = 0; j < batch.length; j++) {
                const isFirst = (i === 0 && j === 0); // 전체 첫 번째 회사인 경우
                await this.processCompany(batch[j], isFirst);
            }
            
            // 배치 완료 후 사용자에게 결제 요청
            if (i + batchSize < companies.length) { // 마지막 배치가 아닌 경우
                console.log(`\n💳 배치 ${batchNumber} 완료! ${batch.length}개 회사 등기 발급이 결제 페이지에 추가되었습니다.`);
                console.log('💡 이제 결제를 진행해주세요.');
                
                const proceed = await this.askQuestion('결제를 완료하셨나요? 다음 배치로 계속하려면 "완료" 또는 "y"를 입력하세요: ');
                
                if (proceed.toLowerCase() === '완료' || 
                    proceed.toLowerCase() === 'y' || 
                    proceed.toLowerCase() === 'yes') {
                    console.log('✅ 결제 완료 확인! 다음 배치를 처리합니다...');
                    
                    // 다음 배치를 위해 다시 검색 페이지로
                    await this.navigateToSearch();
                    await this.setupSearchFilters();
                } else {
                    console.log('⏸️ 사용자가 대기를 선택했습니다.');
                    break;
                }
            } else {
                console.log(`\n🎉 모든 회사 처리 완료! 마지막 배치 결제를 진행해주세요.`);
            }
        }
        
        // 최종 결과 요약
        console.log(`\n📊 ===== 최종 처리 결과 =====`);
        console.log(`✅ 성공: ${this.processedCompanies.length}개`);
        console.log(`❌ 실패: ${this.failedCompanies.length}개`);
        
        if (this.processedCompanies.length > 0) {
            console.log('\n성공한 회사들:');
            this.processedCompanies.forEach((company, index) => {
                console.log(`  ${index + 1}. ${company}`);
            });
        }
        
        if (this.failedCompanies.length > 0) {
            console.log('\n실패한 회사들:');
            this.failedCompanies.forEach(({ company, error }, index) => {
                console.log(`  ${index + 1}. ${company} - ${error}`);
            });
        }
    }

    async readCSVFile(filePath) {
        console.log(`📄 CSV 파일 읽기: ${filePath}`);
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const companies = [];
        
        for (let i = 1; i < lines.length; i++) { // 헤더 제외
            const [, companyName] = lines[i].split(',');
            if (companyName && companyName.trim()) {
                companies.push(companyName.trim());
            }
        }
        
        console.log(`✅ ${companies.length}개 회사 목록 로드: ${companies.join(', ')}`);
        return companies;
    }

    async retryWithRefresh(action, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await action();
                return true;
            } catch (error) {
                console.log(`❌ 시도 ${i + 1} 실패: ${error.message}`);
                if (i < maxRetries - 1) {
                    console.log('🔄 F5 새로고침 후 재시도...');
                    await this.page.keyboard.press('F5');
                    await this.page.waitForLoadState('networkidle');
                    await this.page.waitForTimeout(2000);
                }
            }
        }
        return false;
    }

    async printSummary() {
        console.log('\n📊 ===== 자동화 결과 요약 =====');
        console.log(`✅ 성공한 회사: ${this.processedCompanies.length}개`);
        console.log(`❌ 실패한 회사: ${this.failedCompanies.length}개`);
        
        if (this.processedCompanies.length > 0) {
            console.log('\n성공한 회사 목록:');
            this.processedCompanies.forEach((company, index) => {
                console.log(`  ${index + 1}. ${company}`);
            });
        }
        
        if (this.failedCompanies.length > 0) {
            console.log('\n실패한 회사 목록:');
            this.failedCompanies.forEach((item, index) => {
                console.log(`  ${index + 1}. ${item.company} - ${item.error}`);
            });
        }
        
        console.log(`\n💰 총 예상 결제 금액: ${this.processedCompanies.length * 1000}원`);
        console.log('🎉 자동화 완료!');
    }

    async automateFromCSV(csvPath) {
        try {
            const companies = await this.readCSVFile(csvPath);
            
            await this.start();
            await this.waitForLogin();
            await this.removeAdsAndPopups();
            await this.navigateToSearch();
            await this.setupSearchFilters();
            
            await this.processMultipleCompanies(companies);
            
            await this.printSummary();
            
        } catch (error) {
            console.error('💥 자동화 중 오류 발생:', error);
        } finally {
            // readline 인터페이스 종료
            this.rl.close();
            
            if (this.browser) {
                console.log('🔚 브라우저 종료 중...');
                // await this.browser.close(); // 결과 확인을 위해 주석 처리
            }
        }
    }

    async automateFromUserInput() {
        try {
            console.log('🚀 IROS 법인등기 자동화 시작...');
            
            await this.start();
            await this.waitForLogin();
            await this.removeAdsAndPopups();
            await this.navigateToSearch();
            await this.setupSearchFilters();
            
            // ENV 모드: IROS_COMPANIES 가 있으면 그것을 사용
            let companies = [];
            const companiesEnv = process.env.IROS_COMPANIES;
            if (companiesEnv && companiesEnv.trim()) {
                companies = companiesEnv.split(',').map(name => name.trim()).filter(Boolean);
                console.log(`\n🧪 (ENV) 회사 목록 사용: ${companies.join(', ')}`);
            } else {
                // 사용자에게 회사 목록 입력 요청
                console.log('\n📝 처리할 회사명 목록을 입력해주세요.');
                console.log('💡 여러 회사는 쉼표(,)로 구분하여 입력하세요.');
                console.log('💡 예: 나인바이오웨어, 나노라티스, 비드오리진');
                const companyInput = await this.askQuestion('회사명 목록을 입력하세요: ');
                if (!companyInput || !companyInput.trim()) {
                    throw new Error('회사명이 입력되지 않았습니다.');
                }
                companies = companyInput.split(',').map(name => name.trim()).filter(name => name);
            }
            
            console.log(`\n📊 총 ${companies.length}개 회사 처리 예정:`);
            companies.forEach((company, index) => {
                console.log(`  ${index + 1}. ${company}`);
            });
            
            if (companies.length === 0) {
                throw new Error('유효한 회사명이 없습니다.');
            }
            
            // 배치 크기 계산 및 표시
            const batchSize = 10;
            const totalBatches = Math.ceil(companies.length / batchSize);
            console.log(`\n🎯 ${batchSize}개씩 ${totalBatches}개 배치로 처리합니다.`);
            
            for (let i = 0; i < totalBatches; i++) {
                const start = i * batchSize;
                const end = Math.min(start + batchSize, companies.length);
                const batchCompanies = companies.slice(start, end);
                console.log(`  배치 ${i + 1}: ${batchCompanies.join(', ')}`);
            }
            
            // 비대화형 모드: IROS_AUTO_CONFIRM_START 가 설정되면 바로 진행
            let proceed = (process.env.IROS_AUTO_CONFIRM_START || '').toLowerCase();
            if (!(['y','yes','1'].includes(proceed))) {
                const confirm = await this.askQuestion('\n처리를 시작하시겠습니까? (y/yes): ');
                proceed = confirm.toLowerCase();
                if (!(['y','yes'].includes(proceed))) {
                    console.log('❌ 사용자가 취소했습니다.');
                    return;
                }
            }
            
            // 배치 단위로 회사 처리
            await this.processMultipleCompanies(companies, batchSize);
            
            console.log('\n🎉 모든 작업이 완료되었습니다!');
            
        } catch (error) {
            console.error('💥 자동화 중 오류 발생:', error);
        } finally {
            // readline 인터페이스 종료
            this.rl.close();
            
            if (this.browser) {
                console.log('🔚 브라우저 종료 중...');
                // await this.browser.close(); // 결과 확인을 위해 주석 처리
            }
        }
    }
}

// 사용법
async function main() {
    const automation = new IROSAutomation();
    
    // 사용자 입력으로 회사 목록 받아서 처리
    await automation.automateFromUserInput();
}

// 스크립트가 직접 실행될 때만 main 함수 호출
if (require.main === module) {
    main().catch(console.error);
}

module.exports = IROSAutomation;
