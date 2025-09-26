import os
import pdfplumber
from pathlib import Path
import re
from datetime import datetime

def find_and_rename_latest_pdf():
    """
    다운로드 폴더에서 가장 최신 PDF 파일을 찾아서 
    첫 페이지의 첫 줄 텍스트를 기반으로 파일명을 변경하는 함수
    """
    try:
        # 1. test_pay.js에서 다운로드하는 .playwright-mcp 폴더에서만 최신 PDF 찾기
        current_dir = os.path.dirname(os.path.abspath(__file__))
        download_folder = os.path.join(current_dir, ".playwright-mcp")
        
        print(f"📁 .playwright-mcp 폴더에서 PDF 검색: {download_folder}")
        
        # 2. .playwright-mcp 폴더 존재 확인
        if not os.path.exists(download_folder):
            print("❌ .playwright-mcp 폴더를 찾을 수 없습니다.")
            print("   test_pay.js를 먼저 실행하여 PDF를 다운로드해주세요.")
            return None
            
        pdf_files = [f for f in os.listdir(download_folder) if f.lower().endswith(".pdf")]
        
        if not pdf_files:
            print("❌ .playwright-mcp 폴더에 PDF 파일이 없습니다.")
            print("   test_pay.js를 실행하여 PDF를 다운로드한 후 다시 시도해주세요.")
            return None
        
        # 3. 가장 최근 파일 찾기 (수정 시간 기준)
        latest_file = max(pdf_files, key=lambda x: os.path.getmtime(os.path.join(download_folder, x)))
        latest_path = os.path.join(download_folder, latest_file)
        
        print(f"가장 최근 PDF 파일: {latest_file}")
        
        # 4. pdfplumber로 텍스트 추출
        with pdfplumber.open(latest_path) as pdf:
            if not pdf.pages:
                print("PDF 파일에 페이지가 없습니다.")
                return None
                
            first_page = pdf.pages[0]
            extracted_text = first_page.extract_text()
            
            if not extracted_text:
                print("PDF에서 텍스트를 추출할 수 없습니다.")
                return None
                
            # 첫 줄의 텍스트를 기준으로 파일명 생성
            first_line = extracted_text.strip().split("\n")[0]
            print(f"추출된 첫 줄 텍스트: {first_line}")
            
            # 5. 새 이름 만들기 (특수문자 제거 및 길이 제한)
            import re
            # 파일명에 사용할 수 없는 특수문자 제거
            clean_text = re.sub(r'[<>:"/\\|?*]', '', first_line)
            # 길이 제한 (20글자)
            new_name = clean_text[:20].strip()
            
            if not new_name:
                new_name = "renamed_pdf"
                
            new_name += ".pdf"
            new_path = os.path.join(download_folder, new_name)
            
            # 6. 파일 이름 변경
            if latest_path != new_path:  # 같은 이름이 아닌 경우에만 변경
                try:
                    # 파일이 사용 중인지 확인하고 이름 변경 시도
                    os.rename(latest_path, new_path)
                    print(f"파일 이름 변경 완료: {new_name}")
                    return new_path
                except PermissionError:
                    print(f"파일이 다른 프로그램에서 사용 중입니다. 파일을 닫고 다시 시도해주세요.")
                    print(f"제안된 새 파일명: {new_name}")
                    return latest_path
                except OSError as e:
                    if e.winerror == 32:  # Windows에서 파일이 사용 중일 때
                        print(f"파일이 다른 프로그램에서 사용 중입니다. 파일을 닫고 다시 시도해주세요.")
                        print(f"제안된 새 파일명: {new_name}")
                    else:
                        print(f"파일 이름 변경 중 오류 발생: {str(e)}")
                    return latest_path
            else:
                print("파일명이 이미 적절합니다.")
                return latest_path
                
    except Exception as e:
        print(f"오류가 발생했습니다: {str(e)}")
        return None

def read_pdf_content(pdf_path, page_limit=None):
    """
    PDF 파일의 내용을 읽어서 출력하는 함수
    
    Args:
        pdf_path (str): PDF 파일 경로
        page_limit (int, optional): 읽을 최대 페이지 수 (None이면 전체)
    """
    try:
        print(f"\n=== PDF 내용 읽기: {os.path.basename(pdf_path)} ===")
        
        with pdfplumber.open(pdf_path) as pdf:
            total_pages = len(pdf.pages)
            print(f"총 페이지 수: {total_pages}")
            
            # 읽을 페이지 수 결정
            pages_to_read = min(page_limit, total_pages) if page_limit else total_pages
            
            for page_num in range(pages_to_read):
                page = pdf.pages[page_num]
                text = page.extract_text()
                
                if text:
                    print(f"\n--- 페이지 {page_num + 1} ---")
                    print(text.strip())
                    print("-" * 50)
                else:
                    print(f"\n--- 페이지 {page_num + 1} (텍스트 없음) ---")
                    
            if page_limit and page_limit < total_pages:
                print(f"\n... (총 {total_pages}페이지 중 {page_limit}페이지만 표시)")
                
    except Exception as e:
        print(f"PDF 내용 읽기 중 오류 발생: {str(e)}")

def read_latest_pdf_content(page_limit=None):
    """
    가장 최신 PDF 파일의 내용을 읽는 함수
    
    Args:
        page_limit (int, optional): 읽을 최대 페이지 수
    """
    try:
        # test_pay.js에서 다운로드하는 .playwright-mcp 폴더에서 최신 PDF 찾기
        current_dir = os.path.dirname(os.path.abspath(__file__))
        playwright_mcp_folder = os.path.join(current_dir, ".playwright-mcp")
        
        # .playwright-mcp 폴더만 사용
        download_folder = playwright_mcp_folder
        print(f"📁 .playwright-mcp 폴더에서 PDF 검색: {download_folder}")
        
        # .playwright-mcp 폴더 존재 확인
        if not os.path.exists(download_folder):
            print("❌ .playwright-mcp 폴더를 찾을 수 없습니다.")
            print("   test_pay.js를 먼저 실행하여 PDF를 다운로드해주세요.")
            return None
        
        pdf_files = [f for f in os.listdir(download_folder) if f.lower().endswith(".pdf")]
        
        if not pdf_files:
            print("PDF 파일이 없습니다.")
            return None
            
        latest_file = max(pdf_files, key=lambda x: os.path.getmtime(os.path.join(download_folder, x)))
        latest_path = os.path.join(download_folder, latest_file)
        
        print(f"읽을 파일: {latest_file}")
        read_pdf_content(latest_path, page_limit)
        return latest_path
        
    except Exception as e:
        print(f"오류가 발생했습니다: {str(e)}")
        return None

def extract_registration_number_from_pdf(pdf_path):
    """
    PDF의 첫 페이지에서 등록번호(숫자-숫자 형태)를 추출하는 함수
    
    Args:
        pdf_path (str): PDF 파일 경로
        
    Returns:
        str: 추출된 등록번호 (없으면 None)
    """
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages:
                return None
                
            first_page = pdf.pages[0]
            text = first_page.extract_text()
            
            if not text:
                return None
            
            # 텍스트를 줄별로 분리
            lines = text.strip().split('\n')
            
            # 등록번호 패턴 찾기 (숫자-숫자 형태)
            registration_patterns = [
                r'등록번호\s*[:：]?\s*(\d+-\d+)',  # 등록번호: 123-45-67890
                r'등록번호\s+(\d+-\d+)',          # 등록번호 123-45-67890
                r'(\d{3}-\d{2}-\d{5})',          # 123-45-67890 형태
                r'(\d{3}-\d{2}-\d{6})',          # 123-45-678901 형태
                r'(\d{4}-\d{2}-\d{5})',          # 1234-56-78901 형태
            ]
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # 등록번호 키워드가 있는 줄에서 우선 추출
                if '등록번호' in line:
                    print(f"등록번호가 포함된 줄: {line}")
                    
                    for pattern in registration_patterns:
                        match = re.search(pattern, line)
                        if match:
                            registration_number = match.group(1).strip()
                            print(f"등록번호에서 추출된 번호: {registration_number}")
                            return registration_number
            
            # 등록번호 키워드가 없으면 전체 텍스트에서 패턴 찾기
            full_text = ' '.join(lines)
            for pattern in registration_patterns[2:]:  # 키워드 없는 패턴만 사용
                match = re.search(pattern, full_text)
                if match:
                    registration_number = match.group(1).strip()
                    print(f"패턴으로 추출된 등록번호: {registration_number}")
                    return registration_number
            
            return None
            
    except Exception as e:
        print(f"등록번호 추출 중 오류 발생: {str(e)}")
        return None

def extract_company_name_from_pdf(pdf_path):
    """
    PDF의 첫 페이지에서 상호명을 추출하는 함수
    
    Args:
        pdf_path (str): PDF 파일 경로
        
    Returns:
        str: 추출된 상호명 (없으면 None)
    """
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages:
                return None
                
            first_page = pdf.pages[0]
            text = first_page.extract_text()
            
            if not text:
                return None
            
            # 텍스트를 줄별로 분리
            lines = text.strip().split('\n')
            
            # 1단계: "상호" 키워드가 있는 줄에서 우선 추출
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                    
                if '상호' in line:
                    print(f"상호가 포함된 줄: {line}")
                    
                    # 상호 뒤의 내용 추출 - 더 정확한 패턴
                    patterns = [
                        r'상호\s+([가-힣]+)\s*주식회사',  # 상호 씨와이피커뮤니케이션 주식회사
                        r'상호\s+([가-힣]+)',             # 상호 씨와이피커뮤니케이션
                        r'상호\s*[:：]?\s*([가-힣]+)',     # 상호: 씨와이피커뮤니케이션
                    ]
                    
                    for pattern in patterns:
                        match = re.search(pattern, line)
                        if match:
                            company_name = match.group(1).strip()
                            
                            if company_name and len(company_name) >= 2:
                                print(f"상호에서 추출된 상호명: {company_name}")
                                return company_name
            
            # 2단계: 상호 키워드가 없으면 회사명 패턴 찾기 (등기사항전부증명서 제외)
            for line in lines:
                line = line.strip()
                if not line or '등기사항전부증명서' in line or '등기번호' in line or '등록번호' in line:
                    continue
                    
                # 회사명 패턴 찾기
                company_patterns = [
                    r'([가-힣]+)\s*주식회사\s*\([^)]+\)',  # 한글회사명 주식회사 (영문)
                    r'([가-힣]+)\s*주식회사',              # 한글회사명 주식회사
                    r'([가-힣]+)\s*\([^)]+\)',             # 한글회사명 (영문)
                ]
                
                for pattern in company_patterns:
                    match = re.search(pattern, line)
                    if match:
                        company_name = match.group(1).strip()
                        if company_name and len(company_name) >= 2:
                            print(f"패턴으로 추출된 상호명: {company_name}")
                            return company_name
            
            # 첫 번째 줄에서 회사명 추출 시도
            if lines:
                first_line = lines[0].strip()
                # 한글이 포함된 첫 번째 의미있는 단어 추출
                korean_words = re.findall(r'[가-힣]{2,}', first_line)
                if korean_words:
                    company_name = korean_words[0]
                    print(f"첫 줄에서 추출된 상호명: {company_name}")
                    return company_name
            
            return None
            
    except Exception as e:
        print(f"상호명 추출 중 오류 발생: {str(e)}")
        return None

def auto_rename_pdf_with_company_name():
    """
    가장 최신 PDF 파일을 찾아서 상호명과 등록번호를 추출하고 
    yymmdd_상호명_등록번호 형식으로 파일명을 변경하는 함수
    """
    try:
        # 1. 다운로드 폴더에서 가장 최신 PDF 찾기
        download_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".playwright-mcp")
        print(f"다운로드 폴더 경로: {download_folder}")
        
        if not os.path.exists(download_folder):
            print("다운로드 폴더를 찾을 수 없습니다.")
            return None
            
        pdf_files = [f for f in os.listdir(download_folder) if f.lower().endswith(".pdf")]
        
        if not pdf_files:
            print("다운로드 폴더에 PDF 파일이 없습니다.")
            return None
        
        # 가장 최근 파일 찾기
        latest_file = max(pdf_files, key=lambda x: os.path.getmtime(os.path.join(download_folder, x)))
        latest_path = os.path.join(download_folder, latest_file)
        
        print(f"처리할 파일: {latest_file}")
        
        # 2. 상호명과 등록번호 추출
        company_name = extract_company_name_from_pdf(latest_path)
        registration_number = extract_registration_number_from_pdf(latest_path)
        
        if not company_name:
            print("상호명을 추출할 수 없습니다.")
            return None
        
        if not registration_number:
            print("등록번호를 추출할 수 없습니다.")
            return None
        
        # 3. 현재 날짜(YYMMDD), 상호명, 등록번호로 새 파일명 생성
        current_date = datetime.now().strftime("%y%m%d")  # YYMMDD 형식
        new_name = f"{current_date}_{company_name}_{registration_number}.pdf"
        new_path = os.path.join(download_folder, new_name)
        
        print(f"새 파일명: {new_name}")
        
        # 4. 파일 이름 변경
        if latest_path != new_path:
            try:
                os.rename(latest_path, new_path)
                print(f"파일 이름 변경 완료: {new_name}")
                return new_path
            except PermissionError:
                print(f"파일이 다른 프로그램에서 사용 중입니다. 파일을 닫고 다시 시도해주세요.")
                print(f"제안된 새 파일명: {new_name}")
                return latest_path
            except OSError as e:
                if e.winerror == 32:
                    print(f"파일이 다른 프로그램에서 사용 중입니다. 파일을 닫고 다시 시도해주세요.")
                    print(f"제안된 새 파일명: {new_name}")
                else:
                    print(f"파일 이름 변경 중 오류 발생: {str(e)}")
                return latest_path
        else:
            print("파일명이 이미 적절합니다.")
            return latest_path
            
    except Exception as e:
        print(f"오류가 발생했습니다: {str(e)}")
        return None

def debug_pdf_content():
    """PDF 내용을 디버깅하여 실제 상호명을 찾는 함수"""
    try:
        download_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".playwright-mcp")
        pdf_files = [f for f in os.listdir(download_folder) if f.lower().endswith(".pdf")]
        
        if not pdf_files:
            print("다운로드 폴더에 PDF 파일이 없습니다.")
            return
            
        latest_file = max(pdf_files, key=lambda x: os.path.getmtime(os.path.join(download_folder, x)))
        latest_path = os.path.join(download_folder, latest_file)
        
        print(f"=== PDF 내용 디버깅: {latest_file} ===")
        
        with pdfplumber.open(latest_path) as pdf:
            if not pdf.pages:
                print("PDF 파일에 페이지가 없습니다.")
                return
                
            first_page = pdf.pages[0]
            text = first_page.extract_text()
            
            if not text:
                print("PDF에서 텍스트를 추출할 수 없습니다.")
                return
            
            print("=== 전체 텍스트 ===")
            print(text)
            print("\n" + "="*50)
            
            # 줄별로 분석
            lines = text.strip().split('\n')
            print("=== 줄별 분석 ===")
            for i, line in enumerate(lines, 1):
                line = line.strip()
                if line:
                    print(f"{i:2d}: {line}")
                    
    except Exception as e:
        print(f"디버깅 중 오류 발생: {str(e)}")

def test_extraction_functions():
    """추출 함수들을 테스트하는 함수"""
    try:
        download_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".playwright-mcp")
        pdf_files = [f for f in os.listdir(download_folder) if f.lower().endswith(".pdf")]
        
        if not pdf_files:
            print("다운로드 폴더에 PDF 파일이 없습니다.")
            return
        
        latest_file = max(pdf_files, key=lambda x: os.path.getmtime(os.path.join(download_folder, x)))
        latest_path = os.path.join(download_folder, latest_file)
        
        print(f"=== 테스트 파일: {latest_file} ===")
        
        # 상호명 추출 테스트
        print("\n1. 상호명 추출 테스트:")
        company_name = extract_company_name_from_pdf(latest_path)
        if company_name:
            print(f"   추출된 상호명: {company_name}")
        else:
            print("   상호명을 추출할 수 없습니다.")
        
        # 등록번호 추출 테스트
        print("\n2. 등록번호 추출 테스트:")
        registration_number = extract_registration_number_from_pdf(latest_path)
        if registration_number:
            print(f"   추출된 등록번호: {registration_number}")
        else:
            print("   등록번호를 추출할 수 없습니다.")
        
        # 파일명 생성 테스트
        if company_name and registration_number:
            current_date = datetime.now().strftime("%y%m%d")
            new_name = f"{current_date}_{company_name}_{registration_number}.pdf"
            print(f"\n3. 생성될 파일명: {new_name}")
        else:
            print("\n3. 상호명 또는 등록번호가 없어 파일명을 생성할 수 없습니다.")
            
    except Exception as e:
        print(f"테스트 중 오류 발생: {str(e)}")

def main():
    """메인 실행 함수 - 자동으로 PDF 파일명 변경"""
    print("=== PDF 파일 자동 이름 변경 도구 ===")
    print("가장 최신 PDF 파일에서 상호명과 등록번호를 추출하여 yymmdd_상호명_등록번호 형식으로 파일명을 변경합니다.")
    
    # 사용자에게 선택권 제공
    choice = input("\n1. 자동 파일명 변경\n2. 추출 테스트만 실행\n선택하세요 (1 또는 2): ").strip()
    
    if choice == "2":
        test_extraction_functions()
    else:
        result = auto_rename_pdf_with_company_name()
        
        if result:
            print(f"\n작업 완료: {os.path.basename(result)}")
        else:
            print("\n작업을 완료할 수 없습니다.")

if __name__ == "__main__":
    main()