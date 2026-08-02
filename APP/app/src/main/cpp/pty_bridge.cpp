#include <jni.h>
#include <string>
#include <unistd.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <stdlib.h>
#include <android/log.h>

#define LOG_TAG "PtyBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

extern "C"
JNIEXPORT jint JNICALL
Java_com_cde_app_PtyBridge_spawnPty(JNIEnv *env, jobject thiz, jstring shellPath) {
    // Extract raw C-string BEFORE fork in parent thread (deadlock-free!)
    const char *cShell = env->GetStringUTFChars(shellPath, NULL);
    if (!cShell) {
        return -1;
    }

    int ptyMaster;
    pid_t pid;

    ptyMaster = posix_openpt(O_RDWR | O_CLOEXEC);
    if (ptyMaster < 0) {
        LOGE("Failed to open pseudo-terminal master fd");
        env->ReleaseStringUTFChars(shellPath, cShell);
        return -1;
    }

    if (grantpt(ptyMaster) < 0 || unlockpt(ptyMaster) < 0) {
        LOGE("Failed to grant or unlock pseudo-terminal");
        close(ptyMaster);
        env->ReleaseStringUTFChars(shellPath, cShell);
        return -1;
    }

    char *slaveName = ptsname(ptyMaster);
    if (!slaveName) {
        LOGE("Failed to get slave terminal name");
        close(ptyMaster);
        env->ReleaseStringUTFChars(shellPath, cShell);
        return -1;
    }

    pid = fork();
    if (pid < 0) {
        LOGE("Fork failure");
        close(ptyMaster);
        env->ReleaseStringUTFChars(shellPath, cShell);
        return -1;
    }

    if (pid == 0) {
        setsid();

        int ptySlave = open(slaveName, O_RDWR);
        if (ptySlave < 0) {
            _exit(1);
        }

        dup2(ptySlave, STDIN_FILENO);
        dup2(ptySlave, STDOUT_FILENO);
        dup2(ptySlave, STDERR_FILENO);

        if (ptySlave > STDERR_FILENO) {
            close(ptySlave);
        }
        close(ptyMaster);

        char *args[] = { (char *)cShell, NULL };

        execvp(cShell, args);
        _exit(127);
    } else {
        LOGI("Successfully spawned shell child pid: %d, master fd: %d", pid, ptyMaster);
        env->ReleaseStringUTFChars(shellPath, cShell);
        return ptyMaster;
    }
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_cde_app_PtyBridge_writePty(JNIEnv *env, jobject thiz, jint masterFd, jstring jData) {
    const char *cData = env->GetStringUTFChars(jData, NULL);
    jsize len = env->GetStringUTFLength(jData); // Correct write length derived from GetStringUTFLength

    int written = write(masterFd, cData, len);
    env->ReleaseStringUTFChars(jData, cData);
    return written;
}

extern "C"
JNIEXPORT jstring JNICALL
Java_com_cde_app_PtyBridge_readPty(JNIEnv *env, jobject thiz, jint masterFd) {
    char buf[1024];
    int bytesRead = read(masterFd, buf, sizeof(buf) - 1);
    if (bytesRead <= 0) {
        return NULL;
    }
    buf[bytesRead] = '\0';

    // Sanitize buffer from non-ASCII/invalid UTF-8 bytes to ensure NewStringUTF never crashes
    for (int i = 0; i < bytesRead; i++) {
        if ((unsigned char)buf[i] > 127) {
            buf[i] = '?';
        }
    }

    return env->NewStringUTF(buf);
}
