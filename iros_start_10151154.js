import { parse } from 'csv-parse/sync';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFParser = require('pdf2json');
 
// csv 파일 로딩 및 객체 처리 함수(같은 폴더에 inform.csv 파일이 있어야 함) //
async function getCompanyObjects(filePath = './inform.csv') {
  try {
    // 1. CSV 파일 읽기 및 파싱
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: false,
      from_line: 2, // 헤더 줄(첫 번째 줄) 건너뛰기
      skip_empty_lines: true,
      trim: true,
    });

    // 2. 객체의 키(key) 정의
    const keys = ['등기상호', '등기소', '법인구분', '등기부상태', '본지점구분', '주말여부'];

    // 3. 2차원 배열을 객체 배열로 변환하여 반환
    const companyObjects = records.map(row =>
      Object.fromEntries(keys.map((key, index) => [key, row[index]]))
    );

    console.log(`📄 ${filePath} 로드 및 객체 변환 완료 (총 ${companyObjects.length}건)`);
    return companyObjects;

  } catch (error) {
    console.error(`❌ CSV 파일 처리 중 오류 발생:`, error);
    throw error; // 발생한 오류를 호출한 쪽으로 다시 던져줍니다.
  }
}

 // 법인 상호 검색 함수 //
async function searchBusinessByName(page, businessName) {
  console.log(`\n--- [메인 페이지 검색 시작] 상호명: ${businessName} ---`);

  // (안전장치) 검색창이 화면에 나타날 때까지 확실히 기다립니다.
  console.log('메인 검색창이 나타날 때까지 기다립니다...');
  await page.locator('input[title="부동산및법인조회입력"]').waitFor();

  // 1. '법인' 탭 클릭 (iframe 없이 page 객체로 직접 클릭)
  console.log('"법인" 탭을 클릭합니다...');
  await page.getByRole('radio', { name: '법인' }).click();

  await page.waitForTimeout(500);

  // 2. 검색창에 상호명 입력 (iframe 없이 page 객체로 직접 입력)
  console.log(`검색창에 "${businessName}" 입력 중...`);
  const searchInput = page.locator('input[title="부동산및법인조회입력"]');
  await searchInput.fill(businessName);

  // 3. Enter 키를 눌러 검색 실행
  console.log('Enter 키를 눌러 검색을 실행합니다...');
  await searchInput.press('Enter');

  // 4. 검색 결과 페이지가 로드될 때까지 대기
  console.log('"법인상호 선택" 화면으로 넘어왔는지 확인 중...');
  const pageTitle = page.getByRole('heading', { name: '법인상호 선택' });
  await pageTitle.waitFor({ timeout: 10000 }); // 10초간 대기
  
  
  console.log(`--- [검색 완료] "${businessName}" 결과 확인! ---`);
}
 //법인 등기사항 증명서 열람 발급 신청 함수 //
async function issueCertificate(page, companyData = {}){
  console.log('법인 등기사항 증명서 열람 발급 신청 시작 ')
  // 기본값 설정 //
  const searchOptions= {
    등기소: '전체등기소',
    법인구분: '전체 법인(지배인, 미성년자, 법정대리인 제외)',
    등기부상태: '살아있는 등기',
    본지점구분: '전체 본지점',
    ...companyData
  } ;
  

  try {
    // 1. 등기소 설정
    await page.getByLabel('등기소', { exact: true }).selectOption({ label: searchOptions.등기소 });
    
    // 2. 법인구분 설정
    await page.getByLabel('법인구분', { exact: true }).selectOption({ label: searchOptions.법인구분 });
    
    // 3. 등기부상태 설정
    await page.getByLabel('등기부상태', { exact: true }).selectOption({ label: searchOptions.등기부상태 });
    
    // 4. 본지점구분 설정
    await page.getByLabel('본지점구분', { exact: true }).selectOption({ label: searchOptions.본지점구분 });
    
    await page.waitForTimeout(500); // 설정 후 잠시 대기

    await page.getByLabel('등기상호검색').getByRole('link', { name: '검색' }).click();

    console.log('상세 필터 설정 및 검색 완료.');
    await page.locator('#mf_wfm_potal_main_wfm_content_btn_next').click();
    console.log('다음 버튼 클릭 완료')
  } catch (error) {
    console.log(`⚠️ "${companyData.등기상호}" 검색 필터 설정 중 오류:`, error.message);
    throw error;
  }
}
  // 등기용도 및 등기 유형 선택 함수 //
async function selectCertificateType(page){
    console.log('등기용도 및 등기유형 선택')
    const nextButtonSelector = '#mf_wfm_potal_main_wfm_content_btn_next';
     try{
      await page.locator(nextButtonSelector).click();
      console.log('성공적으로 "다음" 버튼을 클릭했습니다.');
  }catch (error){
    console.error(`오류: '${nextButtonSelector}' 버튼을 찾거나 클릭할 수 없습니다.`, error);
    throw error;
  }
}
  // 등기 항목(필요 항목) 선택 함수 //
  async function selectSpecificItemsAndProceed(page) {
    console.log('📝 특정 등기 항목(14번, 15번) 선택 및 다음 단계 진행 시작...');

    try {
        console.log('14번, 15번 항목을 클릭합니다.');
        
        // 1. data-rowindex="14"를 가진 요소들 중 '첫 번째' 것만 찾아서 강제로 클릭합니다.
        const checkbox14 = page.locator('input.w2grid_embedded_check[data-rowindex="14"]').first();
        await checkbox14.waitFor({ state: 'visible', timeout: 15000 });
        await checkbox14.click({ force: true });
        console.log('✅ 14번 항목 클릭 완료.');
        // 2. data-rowindex="15"를 가진 요소들 중 '첫 번째' 것만 찾아서 강제로 클릭합니다.
        await page.locator('input.w2grid_embedded_check[data-rowindex="15"]').first().click({ force: true });
        
        console.log('✅ 14번, 15번 항목 클릭 완료.');

        // 3. '다음' 버튼 클릭
        await page.locator('#mf_wfm_potal_main_wfm_content_btn_next').click();

        // 4. 로딩 프레임이 사라질 때까지 대기
        const loadingFrame = page.locator('#__processbarIFrame');
        await loadingFrame.waitFor({ state: 'hidden', timeout: 20000 });
        
        console.log('👍 로딩 완료. 다음 페이지로 성공적으로 이동했습니다.');

    } catch (error) {
        console.error('❌ 특정 등기 항목 선택 및 진행 중 오류 발생:', error.message);
        throw Error('특정 등기 항목 선택 및 진행에 실패했습니다.');
    }
}

 // 주민등록번호 공개여부 설정 함수 //
async function setPrivacyOption(page){
  console.log('주민등록번호 공개여부 설정')
  const nextButtonSelector_2 = '#mf_wfm_potal_main_wfm_content_btn_next';
  try{
    await page.locator(nextButtonSelector_2).click();
    console.log('성공적으로 "다음" 버튼을 클릭했습니다.');
  } catch (error){
    console.error('❌ "다음" 버튼 클릭 중 오류가 발생했습니다:', error.message);
    throw error;
  }
}
 // 등기사항 증명서 확인 함수//
async function checkCertificate(page){
  console.log('등기사항 증명서 확인')
  const nextButtonSelector_3 = '#mf_wfm_potal_main_wfm_content_btn_next';
  try{
    await page.locator(nextButtonSelector_3).click();
    console.log('성공적으로 "다음" 버튼을 클릭했습니다.');
  } catch (error){
    console.error('❌ "다음" 버튼 클릭 중 오류가 발생했습니다:', error.message);
    throw error;
  }
}

 //결제 대상 확인 함수 // 
async function checkPaymentTarget(page){
  console.log('결제 대상 확인')
  const paybutton = '#mf_wfm_potal_main_wfm_content_btn_pay';
  const confirmButton = page.getByRole('link', { name: '확인', exact: true });
  try{
    await page.locator(paybutton).click();
    console.log('성공적으로 "결제" 버튼을 클릭했습니다.');
    await confirmButton.click();
    console.log('성공적으로 "확인" 버튼을 클릭했습니다.');
  } catch (error){
    console.error('❌ 결제 또는 확인 버튼 클릭 중 오류가 발생했습니다:', error.message);
    throw error;
  }
}

// 결제 방법 선택 및 결제 실행 함수 //
async function selectPaymentMethod(page){
  console.log('결제 방법으로 "선불전자지급수단"을 선택합니다.')
  try {
    // 1. "선불전자지급수단"이라는 텍스트를 가진 요소를 찾습니다.
    //    Playwright는 이 탭이 나타날 때까지 자동으로 기다립니다.
    const paymentTab = page.getByRole('link', { name: '선불전자지급수단', exact: true });
    await paymentTab.waitFor({ state: 'visible', timeout: 60000 });
    // 2. 찾은 탭을 클릭합니다.
    await paymentTab.click();

    console.log('"선불전자지급수단" 탭을 성공적으로 클릭했습니다.');

    // 3. 선불전자지급수단 결제 정보 입력
    const emoneyInputSelector_front = '#mf_wfm_potal_main_wfm_content_sbx_emoney_code1___input';
    const emoneyInputSelector_back = '#mf_wfm_potal_main_wfm_content_sbx_emoney_code2___input';
    const passwordInputSelector = '#mf_wfm_potal_main_wfm_content_sct_emoney_pwd';
    const emoneyNumber_front = 'L13678818';
    const emoneynumber_back = '9465'
    const password = 'skku1234';
    await page.locator(emoneyInputSelector_front).fill(emoneyNumber_front)
    console.log('성공적으로 선불전자지급수단번호 앞자리를 입력했습니다')
    await page.locator(emoneyInputSelector_back).fill(emoneynumber_back)
    console.log('성공적으로 선불전자지급수단번호 뒷자리를 입력했습니다')
    await page.locator(passwordInputSelector).fill(password);
    console.log('비밀번호를 성공적으로 입력했습니다.');

    //4. 전체동의 체크박스 클릭
    const agreeAllCheckboxSelector = '#mf_wfm_potal_main_wfm_content_chk_whl_agree_input_0';
    await page.locator(agreeAllCheckboxSelector).check({force:true});
    console.log(' "전체동의" 체크박스를 성공적으로 클릭했습니다.');

    //5. 결제 버튼 클릭
    const realpaybutton = '#mf_wfm_potal_main_wfm_content_btn_bpay';
    await page.locator(realpaybutton).click();
    console.log('성공적으로 결제 버튼을 클릭했습니다.');

    //6. 수수료 결제 확인 버튼 누르기 
    console.log('수수료 결제 확인 모달창을 기다립니다...');
    const confirmButton = page.getByRole('link', { name: '확인', exact: true });
    await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
    await confirmButton.click();
    console.log('✅ 성공적으로 수수료 결제 확인 버튼을 클릭했습니다.');

    //7. 결제처리결과 확인 버튼 누르기
    console.log('결제 처리 결과 확인 버튼을 클릭')
    const resultModal = page.locator('div.w2popup_window:has-text("결제처리결과")');
    const resultConfirmButton = resultModal.getByRole('button', { name: '확인', exact: true });
    await resultConfirmButton.waitFor({ state: 'visible', timeout: 20000 });
    await resultConfirmButton.click();
    console.log('성공적으로 결제 처리 결과 확인 버튼을 클릭했습니다')
  }catch (error) {
    console.error('❌ "선불전자지급수단" 단계 중 오류가 발생했습니다:', error.message);
    // 오류가 발생했음을 상위 코드로 알립니다.
    throw new Error('결제 방법 선택에 실패했습니다.');
  }


  
}

// 법인 등기사항 증명서 신청결과 페이지 확인 함수//
async function checkCertificateResult(page){
  console.log('법인 등기사항 증명서 열람 발급 신청결과 확인')
  try{
  // '법인 등기사항증명서 열람·발급 신청결과'라는 제목을 찾습니다.
  const pageTitle = page.getByRole('heading', { name: '법인 등기사항증명서 열람·발급 신청결과', exact: true });

  // 해당 제목이 화면에 보일 때까지 최대 10초간 기다립니다.
  await pageTitle.waitFor({ state: 'visible', timeout: 10000 });

  console.log('✅ 성공: 신청결과 페이지 제목을 확인했습니다.');    
  }catch (error) {
      // 10초가 지나도 제목을 찾지 못하면, catch 블록이 실행됩니다.
      // 오류를 발생시키는 대신, 경고 메시지만 남기고 넘어갑니다.
      console.log('⚠️ 경고: 10초 내에 신청결과 페이지 제목을 찾지 못했지만, 다음 단계를 계속 진행합니다.');
    }
     // 이 아래에 다음 작업을 이어서 작성하면 됩니다.
console.log('신청결과 확인 단계를 마치고 다음 작업을 시작합니다.');

}
//신청결과 열람 발급 함수//
async function viewCertificateResult(page){
  console.log('신청결과 열람 발급 시작');
    
  // ⚠️ 불필요한 긴 초기 대기 제거를 권장합니다. (코드상에는 유지했습니다.)
  await page.waitForTimeout(3000); 

  const popupText = "선택하신 법인을 열람/발급시 함께 결제하신 나머지 건에 대해 결제취소하기 위해서는 열람/발급건에 대한 재결제가 필요합니다.";

  try {
      //1. 열람 버튼 클릭
      // 페이지에 있는 '열람' 버튼 중 첫 번째 요소를 찾습니다.
      
      const firstViewButton = page.getByRole('button', { name: '열람', exact: true }).first();
  
      // 버튼이 화면에 나타나고 클릭 가능할 때까지 최대 10초간 기다립니다.
      await firstViewButton.waitFor({ state: 'visible', timeout: 10000 });
  
      // 버튼을 클릭합니다.
      await firstViewButton.click();
  
      console.log('✅ 성공:"열람" 버튼을 클릭했습니다.');


      // --- 1. 조건부 재결제 팝업 처리 (유지 및 안정화) ---
      try {
          // 팝업이 10초 이내에 나타날지 기다립니다.
          await page.getByText(popupText, { exact: false, timeout: 10000 }).waitFor({
              state: 'visible'
          });
          
          // 팝업이 나타났다면: "확인" 버튼 클릭
          console.log('✅ 재결제 확인 모달 팝업 감지 성공, "확인" 클릭');
          await page.getByRole('link', { name: '확인' }).last().click();
          
      } catch (error) {
          if (error.name === 'TimeoutError') {
              console.log('⚠️ 재결제 확인 팝업이 나타나지 않았습니다. 다음 단계로 진행합니다.');
          } else {
              throw error; // 다른 예상치 못한 오류는 상위 catch 블록으로 전달
          }
      }

      // --- 2. 법인 등기사항증명서 열람 모달 창 대기 ---
      await page.getByRole('button', { name: '출력', exact: true }).waitFor({ 
        state: 'visible', 
        timeout: 15000  
      });
      console.log('✅ 열람 모달창 열림 감지 성공');

      // --- 3. PDF 로드 확인 (이중 iframe 및 고유 ID 접근으로 개선) ---
      try {
         // 1. 외부 PDF 뷰어 컨테이너 프레임 접근 (frameLocator 체인의 시작)
    const outerFrameLocator = page.frameLocator('iframe[id*="wfm_rgsbk"]');

    // 2. 내부 PDF 콘텐츠 프레임 접근
    // outerFrameLocator 안에서 iframe[id*="ifm_pdf_wframe"]을 찾습니다.
    const innerPDFContentFrameLocator = outerFrameLocator.frameLocator('iframe[id*="ifm_pdf_wframe"]');

    // 3. 내부 프레임 안의 고유 텍스트 대기 (띄어쓰기 문제 회피를 위해 exact: false 사용)
    await innerPDFContentFrameLocator.getByText('등기사항전부증명서', { 
        // exact: true 옵션을 제거하여 띄어쓰기와 '(말소사항 포함)' 텍스트의 유무에 유연하게 대처합니다.
        timeout: 15000 
    }).waitFor({
        state: 'visible'
    });
    console.log('✅ PDF 콘텐츠 로드 완료 ("등기사항전부증명서" 텍스트 감지)');

      } catch (pdfError) {
          console.log(`⚠️ PDF 콘텐츠 로드 대기 실패: ${pdfError.message}`);
          // 대체 방법은 유지 (프레임 attached만 확인)
          await page.waitForSelector('iframe', { 
              state: 'attached', 
              timeout: 10000 
          });
          console.log('✅ PDF iframe attached 감지 (대체 확인)');
      } 
      
      // PDF 로드 후 안정화 대기 (유지)
      await page.waitForTimeout(3000);

      // --- 4. “저장” 버튼 클릭 및 다운로드 처리 (완성) ---
      const saveButton = page.getByRole('button', { name: '저장', exact: true });
      await saveButton.waitFor({ state: 'visible', timeout: 10000 });
      console.log('✅ 저장 버튼 감지 성공');
      
      // 🚀 클릭 전에 다운로드 리스너 설정
      const downloadPromise = page.waitForEvent('download');
      
      // 🚀 클릭 실행
      await saveButton.click();
      console.log('✅ 저장 버튼 클릭 성공, 다운로드 대기 중...');

      // 🚀 다운로드 완료 대기 및 파일 저장 활성화
      const download = await downloadPromise;
      // path 모듈이 정의되었다면 아래 코드를 사용합니다.
      // const savePath = path.join('./iros_downloads', download.suggestedFilename());
      // await download.saveAs(savePath);
      
      // path 모듈이 없을 경우 임시 경로에 저장
      // (실제 프로젝트에서는 path.join을 사용하세요)
      await download.saveAs(`./iros_downloads/${download.suggestedFilename()}`);
      console.log(`✅ 다운로드 완료: ${download.suggestedFilename()}`);

  } catch (error) {
      console.error('❌ 최종 처리 중 오류 발생:', error.message);
      throw error;
  }
}
// 📌 PDF 처리 및 파일명 변경 통합 함수
async function processPdfAndRename(folderPath = './iros_downloads') {
  try {
    // 1. 최신 PDF 파일 찾기
    const files = await fs.readdir(folderPath);
    const pdfFiles = [];
    for (const file of files) {
      if (file.endsWith('.pdf')) {
        const filePath = path.join(folderPath, file);
        const stats = await fs.stat(filePath);
        pdfFiles.push({ path: filePath, time: stats.mtime.getTime() });
      }
    }
    
    if (pdfFiles.length === 0) {
      console.log('❌ PDF 파일이 없습니다.');
      return;
    }
    
    pdfFiles.sort((a, b) => b.time - a.time);
    const latestPdfPath = pdfFiles[0].path;
    console.log('📄 최신 PDF:', latestPdfPath);

    // 2. PDF 텍스트 추출
    const text = await new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();
      
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        let fullText = '';
        if (pdfData.Pages) {
          pdfData.Pages.forEach((page) => {
            if (page.Texts) {
              page.Texts.forEach((text) => {
                if (text.R) {
                  text.R.forEach((r) => {
                    if (r.T) {
                      try {
                        fullText += decodeURIComponent(r.T) + ' ';
                      } catch (e) {
                        fullText += r.T + ' ';
                      }
                    }
                  });
                }
              });
              fullText += '\n';
            }
          });
        }
        resolve(fullText.trim());
      });
      
      pdfParser.on('pdfParser_dataError', (error) => {
        reject(new Error(`PDF 파싱 오류: ${error.parserError}`));
      });
      
      pdfParser.loadPDF(latestPdfPath);
    });
    
    // 3. 회사명 추출
    const companyMatch = text.match(/상\s*호\s+(.+?)(?=\s+본\s*점|목\s*적|공고방법|$)/s);
    if (!companyMatch) {
      console.log('❌ 회사명 추출 실패');
      return;
    }
    
    const companies = companyMatch[1].match(/주식회사\s+[^\s]+(?:\s+\([^)]+\))?/g);
    if (!companies || companies.length === 0) {
      console.log('❌ 회사명 추출 실패');
      return;
    }
    
    const companyName = companies[companies.length - 1].trim().replace(/\s+/g, ' ');
    console.log('🏢 추출된 회사명:', companyName);

    // 4. 등록번호 추출
    const regMatch = text.match(/등록번호\s+(\d{6}-\d{7})/);
    if (!regMatch) {
      console.log('❌ 등록번호 추출 실패');
      return;
    }
    
    const registrationNumber = regMatch[1];
    console.log('🔢 추출된 등록번호:', registrationNumber);

    // 5. 파일명 변경
    const now = new Date();
    const yymmdd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const safeCompanyName = companyName.replace(/[\\/:*?"<>|]/g, '_');
    const newFileName = `${yymmdd}_${safeCompanyName}_${registrationNumber}.pdf`;
    const newFilePath = path.join(folderPath, newFileName);

    await fs.rename(latestPdfPath, newFilePath);
    
    console.log('\n🎉 파일 이름 변경 성공!');
    console.log(`   이전: ${path.basename(latestPdfPath)}`);
    console.log(`   이후: ${newFileName}`);

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    throw error;
  }
}
(async () => {
  const companyObjects = await getCompanyObjects();
  // 실제 Chrome 브라우저를 실행합니다.
  const browser = await chromium.launch({
    channel: 'chrome', // 'chrome' 채널을 지정하여 실제 Chrome 사용
    headless: false,   // false로 설정하여 브라우저 창을 직접 확인
  });
  //다운로드 경로 설정
  const downloadFolder = path.join(process.cwd(), 'iros_downloads');
  console.log(`📂 다운로드 폴더가 다음 경로로 설정되었습니다: ${downloadFolder}`);

  const context = await browser.newContext({
    acceptDownloads: true, // 다운로드 허용 (필수)
    downloadsPath: downloadFolder // 다운로드 기본 경로 지정
  });
  const page = await context.newPage();

  // 1. 인터넷 등기소 메인 페이지로 이동
  await page.goto('https://www.iros.go.kr/PMainJ.jsp', { timeout: 60000 });

  
  // 2. 첫 번째 '로그인' 링크(메뉴 열기)를 클릭합니다.
  console.log('첫 번째 로그인 버튼 (메뉴 열기) 클릭 중...');
  await page.getByRole('link', { name: '로그인' }).first().click();

  // 2-1 드롭다운 메뉴에 있는 두 번째 '로그인' 링크를 클릭합니다.
  // Playwright는 자동으로 요소가 나타날 때까지 기다려줍니다.
  console.log('두 번째 로그인 버튼 (드롭다운 메뉴) 클릭 중...');
  await page.getByRole('link', { name: '로그인' }).nth(1).click();

  // 페이지가 완전히 로드될 때까지 기다립니다.
  await page.waitForLoadState('domcontentloaded');

  // 3. 아이디와 비밀번호 입력
  // '사용자_아이디'와 '사용자_비밀번호'를 실제 정보로 바꾸세요.
  await page.locator('input[title="아이디입력"]:visible').fill('shrjswns');
  await page.locator('input[title="비밀번호입력"]:visible').fill('dabin58781!');

  // 4. 로그인 버튼 클릭
  await page.getByRole('button', { name: '로그인' }).click();

  console.log('로그인 시도 완료.');
  // 로그인이 성공했는지 확인하거나 다른 작업을 수행할 수 있습니다.
  // 예를 들어, 특정 페이지로 이동하거나 요소가 나타나는지 확인합니다.
  await page.waitForTimeout(5000); // 5초 대기
  
  console.log('로그인 완료 확인 중...');
  let successCount = 0;
  let failCount = 0;
  const failedCompanies = [];

  for (const company of companyObjects) {
  try{
    // 메인페이지 확인(로그아웃 버튼이 존재하면 정상 로그인된 상태인 메인페이지입니다다)
  await page.getByRole('link', { name: '로그아웃' }).first().waitFor();
  console.log('메인 페이지입니다.');
  try {
    console.log('팝업 창 닫기 시도...');
    // '오늘 하루 열지 않음', '닫기' 등의 버튼을 찾아서 클릭
    await page.getByRole('button', { name: /닫기|오늘 하루 열지 않음/ }).click({ timeout: 5000 }); // 5초만 기다림
    console.log('팝업 창을 닫았습니다.');
  } catch (e) {
    console.log('팝업 창이 발견되지 않았습니다. 계속 진행합니다.');
  }
    // --- 3. 검색 함수 호출 ---// 
  await searchBusinessByName(page,company.등기상호);
  // ---4.법인 등기사항 증명서 열람·발급 신청---//
  await issueCertificate(page,company)
  // ---5. 등기용도 및 등기유형 선택---//
  await selectCertificateType(page)
  // ---6. 등기 항목(필요 항목) 선택---//
  await selectSpecificItemsAndProceed(page) 
  // --7. 주민등록번호 공개여부 설정---//
  await setPrivacyOption(page)
  // ---8. 등기사항 증명서 확인---//
  await checkCertificate(page)  
  // ---9. 결제 대상 확인---//
  await checkPaymentTarget(page)  
  // --10. 결제 방법 선택 및 결제 실행--//
  await selectPaymentMethod(page)
  // --11. 법인 등기사항증명서 신청결과 페이지 확인 --//
  await checkCertificateResult(page)
  // --12. 신청결과 열람 발급 -- //
  await viewCertificateResult(page)
  // --13. PDF 처리 및 파일명 변경 -- //
  await processPdfAndRename(); 
  successCount++;
  await page.reload();
  }catch (error) {
    failCount++;
    failedCompanies.push(company.등기상호); // 실패 목록에 실패 회사 추가
    //오류시 다음회사로 넘어감
    console.error (`⚠️ [${company.등기상호}] 처리 중 심각한 오류가 발생하여 다음 회사로 넘어갑니다.`);
    // 페이지 새로고침하면 홈페이지로 돌아감
    await page.reload();

  }

  }
  console.log('   최종 작업 결과');
  console.log('====================');
  console.log(`✅ 성공: ${successCount}건`);
  console.log(`❌ 실패: ${failCount}건`);
  if (failCount > 0) {
    console.log(' 실패한 상호명:', failedCompanies.join(', '));
}
})();
