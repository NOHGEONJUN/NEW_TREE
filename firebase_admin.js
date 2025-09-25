const admin = require("firebase-admin");
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const serviceAccount = require("./project-d1cb6-firebase-adminsdk-fbsvc-1f8039e12d.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://project-d1cb6-default-rtdb.firebaseio.com",
  storageBucket: "project-d1cb6.firebasestorage.app"
});

const db = admin.database();
const bucket = admin.storage().bucket();

// Firebase Storage에서 음성파일 다운로드 함수 (PCM 파일 제외)
async function downloadAudioFile(fileName, localPath = null) {
  try {
    console.log(`📥 Firebase Storage에서 음성파일 다운로드 시작: ${fileName}`);
    
    // PCM 파일인지 확인하고 제외
    if (fileName.toLowerCase().endsWith('.pcm')) {
      console.log(`⏭️ PCM 파일은 제외됩니다: ${fileName}`);
      return null;
    }
    
    // 지원하는 파일 형식인지 확인
    const supportedFormats = ['.mp3', '.wav', '.m4a', '.ogg'];
    const fileExtension = path.extname(fileName).toLowerCase();
    
    if (!supportedFormats.includes(fileExtension)) {
      console.log(`⏭️ 지원하지 않는 파일 형식입니다: ${fileName}`);
      return null;
    }
    
    // 로컬 저장 경로 설정 (TTS_STT 폴더)
    if (!localPath) {
      localPath = path.join(__dirname, 'TTS_STT', fileName);
    }
    
    // Firebase Storage에서 파일 다운로드
    const file = bucket.file(fileName);
    const [exists] = await file.exists();
    
    if (!exists) {
      console.log(`❌ 파일이 존재하지 않습니다: ${fileName}`);
      return null;
    }
    
    // 파일 다운로드
    await file.download({
      destination: localPath
    });
    
    console.log(`✅ 음성파일 다운로드 완료: ${localPath}`);
    return localPath;
    
  } catch (error) {
    console.error(`❌ 음성파일 다운로드 실패: ${error.message}`);
    return null;
  }
}

// Firebase Storage의 모든 음성파일 목록 조회
async function listAudioFiles() {
  try {
    console.log('📋 Firebase Storage 음성파일 목록 조회 중...');
    
    const [files] = await bucket.getFiles({
      // prefix 제거하여 모든 폴더에서 검색
    });
    
    const audioFiles = files
      .filter(file => file.name.match(/\.(mp3|wav|m4a|ogg)$/i)) // PCM 파일 제외, WAV 파일만 포함
      .map(file => file.name);
    
    console.log(`📁 발견된 음성파일 ${audioFiles.length}개:`);
    audioFiles.forEach(file => console.log(`  - ${file}`));
    
    return audioFiles;
    
  } catch (error) {
    console.error(`❌ 파일 목록 조회 실패: ${error.message}`);
    return [];
  }
}

// 모든 음성파일을 TTS_STT 폴더로 다운로드
async function downloadAllAudioFiles() {
  try {
    console.log('🚀 모든 음성파일 다운로드 시작...');
    
    // TTS_STT 폴더가 없으면 생성
    const ttsSttDir = path.join(__dirname, 'TTS_STT');
    if (!fs.existsSync(ttsSttDir)) {
      fs.mkdirSync(ttsSttDir, { recursive: true });
      console.log('📁 TTS_STT 폴더 생성 완료');
    }
    
    // Firebase Storage에서 음성파일 목록 조회
    const audioFiles = await listAudioFiles();
    
    if (audioFiles.length === 0) {
      console.log('📭 다운로드할 음성파일이 없습니다.');
      return [];
    }
    
    // 각 파일 다운로드
    const downloadedFiles = [];
    for (const fileName of audioFiles) {
      const localFileName = path.basename(fileName); // 폴더 경로 제거하고 파일명만 추출
      const localPath = path.join(ttsSttDir, localFileName);
      
      const downloadedPath = await downloadAudioFile(fileName, localPath);
      if (downloadedPath) {
        downloadedFiles.push(downloadedPath);
      }
    }
    
    console.log(`✅ 다운로드 완료: ${downloadedFiles.length}개 파일`);
    return downloadedFiles;
    
  } catch (error) {
    console.error(`❌ 전체 다운로드 실패: ${error.message}`);
    return [];
  }
}

// 특정 음성파일 다운로드 (파일명으로, PCM 파일 제외)
async function downloadSpecificAudioFile(fileName) {
  try {
    console.log(`🎯 특정 음성파일 다운로드: ${fileName}`);
    
    // PCM 파일인지 확인하고 제외
    if (fileName.toLowerCase().endsWith('.pcm')) {
      console.log(`⏭️ PCM 파일은 다운로드하지 않습니다: ${fileName}`);
      return null;
    }
    
    // TTS_STT 폴더가 없으면 생성
    const ttsSttDir = path.join(__dirname, 'TTS_STT');
    if (!fs.existsSync(ttsSttDir)) {
      fs.mkdirSync(ttsSttDir, { recursive: true });
    }
    
    const localPath = path.join(ttsSttDir, fileName);
    const downloadedPath = await downloadAudioFile(fileName, localPath);
    
    return downloadedPath;
    
  } catch (error) {
    console.error(`❌ 특정 파일 다운로드 실패: ${error.message}`);
    return null;
  }
}

// 기존 사용자 데이터 설정 (호환성 유지)
db.ref("users").set({
  user1: { name: "Alice" },
  user2: { name: "Bob" }
});

// Firebase Storage에 음성파일 업로드 함수
async function uploadAudioFile(localFilePath, remoteFileName = null) {
  try {
    console.log(`📤 Firebase Storage에 음성파일 업로드 시작: ${localFilePath}`);
    
    // 원격 파일명 설정 (지정되지 않으면 로컬 파일명 사용)
    if (!remoteFileName) {
      remoteFileName = path.basename(localFilePath);
    }
    
    // 로컬 파일 존재 확인
    if (!fs.existsSync(localFilePath)) {
      console.log(`❌ 로컬 파일이 존재하지 않습니다: ${localFilePath}`);
      return null;
    }
    
    // Firebase Storage에 파일 업로드
    const file = bucket.file(remoteFileName);
    await bucket.upload(localFilePath, {
      destination: remoteFileName,
      metadata: {
        contentType: 'audio/wav', // WAV 파일 타입
        metadata: {
          uploadedAt: new Date().toISOString(),
          source: 'TTS_STT_System'
        }
      }
    });
    
    console.log(`✅ 음성파일 업로드 완료: ${remoteFileName}`);
    return remoteFileName;
    
  } catch (error) {
    console.error(`❌ 음성파일 업로드 실패: ${error.message}`);
    return null;
  }
}

// 여러 음성파일을 일괄 업로드
async function uploadMultipleAudioFiles(localFilePaths, remoteFileNames = null) {
  try {
    console.log('🚀 여러 음성파일 업로드 시작...');
    
    const uploadedFiles = [];
    
    for (let i = 0; i < localFilePaths.length; i++) {
      const localPath = localFilePaths[i];
      const remoteName = remoteFileNames ? remoteFileNames[i] : null;
      
      const uploadedName = await uploadAudioFile(localPath, remoteName);
      if (uploadedName) {
        uploadedFiles.push(uploadedName);
      }
      
      // 업로드 간격 조절
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`✅ 업로드 완료: ${uploadedFiles.length}개 파일`);
    return uploadedFiles;
    
  } catch (error) {
    console.error(`❌ 일괄 업로드 실패: ${error.message}`);
    return [];
  }
}

// TTS_STT 폴더의 모든 WAV 파일을 업로드
async function uploadAllWavFilesFromTtsStt() {
  try {
    console.log('📁 TTS_STT 폴더의 WAV 파일들 업로드 시작...');
    
    const ttsSttDir = path.join(__dirname, 'TTS_STT');
    
    if (!fs.existsSync(ttsSttDir)) {
      console.log('❌ TTS_STT 폴더가 존재하지 않습니다.');
      return [];
    }
    
    // WAV 파일 목록 조회
    const files = fs.readdirSync(ttsSttDir);
    const wavFiles = files
      .filter(file => file.toLowerCase().endsWith('.wav'))
      .map(file => path.join(ttsSttDir, file));
    
    if (wavFiles.length === 0) {
      console.log('📭 업로드할 WAV 파일이 없습니다.');
      return [];
    }
    
    console.log(`📁 발견된 WAV 파일 ${wavFiles.length}개:`);
    wavFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
    
    // 모든 WAV 파일 업로드
    const uploadedFiles = await uploadMultipleAudioFiles(wavFiles);
    
    return uploadedFiles;
    
  } catch (error) {
    console.error(`❌ TTS_STT 폴더 업로드 실패: ${error.message}`);
    return [];
  }
}

// Python 스크립트 실행 함수
async function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`🐍 Python 스크립트 실행: ${scriptPath}`);
    
    const pythonProcess = spawn('python', [scriptPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname
    });
    
    let stdout = '';
    let stderr = '';
    
    // 표준 출력 처리
    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[Python] ${output.trim()}`);
    });
    
    // 표준 오류 처리
    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      console.error(`[Python Error] ${error.trim()}`);
    });
    
    // 프로세스 종료 처리
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Python 스크립트 실행 완료');
        resolve({ success: true, stdout, stderr });
      } else {
        console.error(`❌ Python 스크립트 실행 실패 (종료 코드: ${code})`);
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
      }
    });
    
    // 프로세스 오류 처리
    pythonProcess.on('error', (error) => {
      console.error(`❌ Python 프로세스 오류: ${error.message}`);
      reject(error);
    });
  });
}

// AI 처리 함수 (Python 스크립트 실행)
async function runAiProcessing() {
  try {
    console.log('🤖 AI 처리 시작...');
    
    const scriptPath = path.join(__dirname, 'new_ai_fixed.py');
    
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Python 스크립트를 찾을 수 없습니다: ${scriptPath}`);
    }
    
    const result = await runPythonScript(scriptPath);
    
    console.log('🎉 AI 처리 완료!');
    return result;
    
  } catch (error) {
    console.error(`❌ AI 처리 실패: ${error.message}`);
    throw error;
  }
}

// 전체 워크플로우 실행 함수
async function runCompleteWorkflow() {
  try {
    console.log('🚀 전체 워크플로우 시작...');
    console.log('=' * 50);
    
    // 1단계: Firebase Storage에서 WAV 파일 다운로드
    console.log('\n📥 1단계: Firebase Storage에서 WAV 파일 다운로드');
    const downloadedFiles = await downloadAllAudioFiles();
    
    if (downloadedFiles.length === 0) {
      console.log('📭 다운로드할 파일이 없습니다. 워크플로우를 종료합니다.');
      return { success: false, message: '다운로드할 파일이 없음' };
    }
    
    console.log(`✅ ${downloadedFiles.length}개 파일 다운로드 완료`);
    
    // 2단계: AI 처리 (Python 스크립트 실행)
    console.log('\n🤖 2단계: AI 처리 (STT → AI 응답 → TTS)');
    const aiResult = await runAiProcessing();
    
    if (!aiResult.success) {
      throw new Error('AI 처리 실패');
    }
    
    console.log('✅ AI 처리 완료');
    
    // 3단계: 처리된 WAV 파일들을 Firebase Storage에 업로드
    console.log('\n📤 3단계: 처리된 WAV 파일들을 Firebase Storage에 업로드');
    const uploadedFiles = await uploadAllWavFilesFromTtsStt();
    
    console.log(`✅ ${uploadedFiles.length}개 파일 업로드 완료`);
    
    // 결과 요약
    console.log('\n🎊 전체 워크플로우 완료!');
    console.log('=' * 50);
    console.log(`📥 다운로드: ${downloadedFiles.length}개 파일`);
    console.log(`🤖 AI 처리: 완료`);
    console.log(`📤 업로드: ${uploadedFiles.length}개 파일`);
    
    return {
      success: true,
      downloaded: downloadedFiles.length,
      processed: true,
      uploaded: uploadedFiles.length,
      downloadedFiles,
      uploadedFiles
    };
    
  } catch (error) {
    console.error(`❌ 워크플로우 실행 실패: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// 모듈 내보내기
module.exports = {
  downloadAudioFile,
  listAudioFiles,
  downloadAllAudioFiles,
  downloadSpecificAudioFile,
  uploadAudioFile,
  uploadMultipleAudioFiles,
  uploadAllWavFilesFromTtsStt,
  runPythonScript,
  runAiProcessing,
  runCompleteWorkflow,
  db,
  bucket
};

// 직접 실행 시 전체 워크플로우 실행
if (require.main === module) {
  console.log('🎯 Firebase Admin JS - 전체 워크플로우 실행');
  console.log('=' * 60);
  
  runCompleteWorkflow()
    .then(result => {
      if (result.success) {
        console.log('\n🎉 전체 워크플로우 성공적으로 완료되었습니다!');
        console.log(`📊 결과: 다운로드 ${result.downloaded}개, 업로드 ${result.uploaded}개`);
      } else {
        console.log('\n❌ 워크플로우 실행 실패');
        console.log(`오류: ${result.error || result.message}`);
      }
    })
    .catch(error => {
      console.error('\n💥 예상치 못한 오류 발생:', error.message);
    });
}