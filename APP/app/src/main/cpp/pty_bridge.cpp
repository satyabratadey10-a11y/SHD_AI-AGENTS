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
Java_com_cde_app_PtyBridge_spawnPty(JNIEnv *env, jobject thiz, jstring shellPath, jobjectArray jArgs, jobjectArray jEnv) {
    int ptyMaster;
    pid_t pid;

    // 1. Allocate POSIX pseudo-terminal (PTY)
    ptyMaster = posix_openpt(O_RDWR | O_CLOEXEC);
    if (ptyMaster < 0) {
        LOGE("Failed to open pseudo-terminal master fd");
        return -1;
    }

    if (grantpt(ptyMaster) < 0 || unlockpt(ptyMaster) < 0) {
        LOGE("Failed to grant or unlock pseudo-terminal");
        close(ptyMaster);
        return -1;
    }

    char *slaveName = ptsname(ptyMaster);
    if (!slaveName) {
        LOGE("Failed to get slave terminal name");
        close(ptyMaster);
        return -1;
    }

    // 2. Fork the shell process
    pid = fork();
    if (pid < 0) {
        LOGE("Fork failure");
        close(ptyMaster);
        return -1;
    }

    if (pid == 0) {
        // Slave/Child Process: Establish controlling terminal
        setsid();

        int ptySlave = open(slaveName, O_RDWR);
        if (ptySlave < 0) {
            _exit(1);
        }

        // Redirect standard descriptors to PTY slave
        dup2(ptySlave, STDIN_FILENO);
        dup2(ptySlave, STDOUT_FILENO);
        dup2(ptySlave, STDERR_FILENO);

        if (ptySlave > STDERR_FILENO) {
            close(ptySlave);
        }
        close(ptyMaster);

        // Convert parameters to standard char arrays
        const char *cShell = env->GetStringUTFChars(shellPath, NULL);
        char *args[] = { (char *)cShell, NULL };

        execvp(cShell, args);
        _exit(127);
    } else {
        // Master/Parent Process
        LOGI("Successfully spawned shell child pid: %d, master fd: %d", pid, ptyMaster);
        return ptyMaster;
    }
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_cde_app_PtyBridge_writePty(JNIEnv *env, jobject thiz, jint masterFd, jstring jData) {
    const char *cData = env->GetStringUTFChars(jData, NULL);
    jsize len = env->GetStringLength(jData);

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
    return env->NewStringUTF(buf);
}
