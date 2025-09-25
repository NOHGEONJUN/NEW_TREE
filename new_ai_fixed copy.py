import os
from openai import OpenAI
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from langchain.schema import HumanMessage, SystemMessage
import requests

# API 키 설정 (보안 개선)
# 방법 1: 환경변수 사용 (권장)
api_key = os.environ.get("OPENAI_API_KEY")

# 방법 2: 환경변수가 없으면 직접 설정 (개발용)
if not api_key:
    api_key = "your_key"

# ElevenLabs API 키 설정
elevenlabs_api_key = os.environ.get("ELEVENLABS_API_KEY")
if not elevenlabs_api_key:
    elevenlabs_api_key = "발급받은_API_KEY"  # 실제 API 키로 교체 필요

# OpenAI 클라이언트 초기화
client = OpenAI(api_key=api_key)

def stt_only(audio_file_path="audio_file.m4a"):
    """
    음성을 텍스트로 변환하는 함수 (분석 제거)
    
    Args:
        audio_file_path (str): 분석할 오디오 파일 경로
    
    Returns:
        str: 변환된 텍스트
    """
    try:
        # --- 1단계: Whisper를 사용한 음성 → 텍스트 변환 ---
        with open(audio_file_path, "rb") as audio_file:
            transcript_text = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="ko",
                response_format="text"
            )
        
        # STT 완료 (출력 제거)
        
        return transcript_text
            
    except FileNotFoundError:
        print(f"❌ 오류: '{audio_file_path}' 파일을 찾을 수 없습니다.")
        print("파일 경로를 확인해주세요.")
        return None
        
    except Exception as e:
        print(f"❌ 오류가 발생했습니다: {e}")
        return None

def generate_response_with_persona(transcript_text, persona_type="손녀딸"):
    """
    LangChain을 사용하여 페르소나 기반 응답을 생성합니다.
    
    Args:
        transcript_text (str): STT로 변환된 텍스트
        persona_type (str): 페르소나 타입 ("상담사", "친구", "멘토", "코치")
    
    Returns:
        str: LLM이 생성한 응답 텍스트
    """
    try:
        # LangChain ChatOpenAI 모델 초기화 (더 빠른 모델 사용)
        llm = ChatOpenAI(
            model="gpt-3.5-turbo",  # gpt-4o-mini보다 빠름
            temperature=0.5,        # 0.8에서 0.7로 낮춤 (더 빠른 응답)
            max_tokens=120,         # 200에서 150으로 줄임 (더 빠른 응답)
            api_key=api_key
        )
        
        # 간소화된 시스템 프롬프트
        system_prompt = """당신은 사용자의 20대 초반 손녀딸입니다. 반드시 사용자를 '할아버지'라고 부르며 친근하고 다정하게 대화하세요. 
        1-2문장으로 간결하게 답변하고, 이모티콘은 사용하지 마세요."""
        
        # LangChain 프롬프트 템플릿 생성
        system_message = SystemMessage(content=system_prompt)
        human_message = HumanMessage(content=f"사용자: '{transcript_text}'")
        
        # LangChain을 사용한 응답 생성
        messages = [system_message, human_message]
        response = llm.invoke(messages)
        
        response_text = response.content.strip()
        
        return response_text
        
    except Exception as e:
        print(f"❌ {persona_type} 페르소나 응답 생성 실패: {e}")
        return f"죄송합니다. {persona_type} 응답을 생성하는데 문제가 발생했습니다."

def generate_response(client, transcript_text):
    """
    기존 방식의 응답 생성 (호환성을 위해 유지)
    """
    return generate_response_with_persona(transcript_text, "손녀딸")

def text_to_speech_elevenlabs(text, output_file="ai_response.mp3"):
    """
    ElevenLabs를 사용하여 텍스트를 음성으로 변환합니다.
    
    Args:
        text (str): 변환할 텍스트
        output_file (str): 출력 파일명
    
    Returns:
        str: 생성된 음성 파일 경로
    """
    try:
        # ElevenLabs API 설정
        url = "https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9"  # Jessica
        
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": "xi-key"
        }
        
        data = {
            "text": text,
            "model_id": "eleven_turbo_v2_5",  # 더 빠른 터보 모델 사용
            "voice_settings": {
                "stability": 0.4,        # 약간 높여서 안정성 확보
                "similarity_boost": 0.8, # 약간 낮춰서 처리 속도 향상
                "style": 0.1,            # 스타일 낮춰서 처리 속도 향상
                "use_speaker_boost": True
            },
            "output_format": "mp3_22050_32"  # 더 빠른 처리 (22kHz)
        }
        
        # API 요청
        response = requests.post(url, headers=headers, json=data)
        
        if response.status_code == 200:
            # 음성 파일 저장
            with open(output_file, "wb") as f:
                f.write(response.content)
            
            # TTS 완료 (출력 제거)
            return output_file
        else:
            print(f"❌ TTS 오류: {response.status_code}")
            return None
        
    except Exception as e:
        print(f"❌ ElevenLabs TTS 변환 실패: {e}")
        return None

# 기존 함수명 유지 (호환성을 위해)
def text_to_speech(client, text, output_file="ai_response.mp3"):
    """기존 함수명 유지 (ElevenLabs 사용)"""
    return text_to_speech_elevenlabs(text, output_file)

def display_results(transcript_text, analysis_results):
    """
    분석 결과를 보기 좋게 출력하는 함수
    
    Args:
        transcript_text (str): 변환된 텍스트
        analysis_results (dict): 분석 결과들
    """
    if not transcript_text or not analysis_results:
        return
    
    print("\n" + "=" * 60)
    print("📊 최종 분석 결과")
    print("=" * 60)
    
    print(f"\n📝 원본 텍스트:")
    print("-" * 40)
    print(transcript_text)
    print("-" * 40)
    
    for analysis_name, result in analysis_results.items():
        print(f"\n🔍 {analysis_name.upper()}:")
        print("-" * 30)
        print(result)
        print("-" * 30)
    
    print("\n" + "=" * 60)
    print("✅ 모든 분석이 완료되었습니다!")
    print("=" * 60)

# 통합 대화 시스템 함수 (빠른 버전)
def complete_conversation_system(audio_file_path="audio_file.m4a", persona_type="손녀딸"):
    """
    STT → LLM 응답 생성 → TTS의 빠른 대화 시스템
    
    Args:
        audio_file_path (str): 분석할 오디오 파일 경로
        persona_type (str): 페르소나 타입 ("상담사", "친구","손녀딸")
    
    Returns:
        tuple: (STT_텍스트, AI_응답, 음성_파일_경로)
    """
    try:
        print("🤖 AI 대화 시작...")
        
        # 1단계: STT 변환
        transcript = stt_only(audio_file_path)
        if not transcript:
            print("❌ STT 실패")
            return None, None, None
        
        # 2단계: LLM 응답 생성
        ai_response = generate_response_with_persona(transcript, persona_type)
        
        # 3단계: TTS 변환
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        tts_file = f"ai_response_{timestamp}.mp3"
        audio_file = text_to_speech(client, ai_response, tts_file)
        
        # 결과 요약 출력
        print(f"\n📝 사용자: {transcript}")
        print(f"💬 AI: {ai_response}")
        if audio_file:
            print(f"🎵 음성: {audio_file}")
        print("✅ 완료!")
        
        return transcript, ai_response, audio_file
        
    except Exception as e:
        print(f"❌ 시스템 오류: {e}")
        return None, None, None

# 메인 실행
if __name__ == "__main__":
    print("🤖 AI 대화 시스템 시작...")
    transcript, response, audio = complete_conversation_system("audio_file.m4a", "손녀딸")
    
    if transcript and response:
        print("🎊 대화 완료!")
    else:
        print("❌ 대화 실패")
