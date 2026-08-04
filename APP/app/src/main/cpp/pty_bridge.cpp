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

static pid_t childPid = -1;

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
        childPid = pid; // Retain spawned child pid in native state
        env->ReleaseStringUTFChars(shellPath, cShell);
        return ptyMaster;
    }
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_cde_app_PtyBridge_writePty(JNIEnv *env, jobject thiz, jint masterFd, jstring jData) {
    const char *cData = env->GetStringUTFChars(jData, NULL);
    if (!cData) {
        return -1;
    }
    jsize len = env->GetStringUTFLength(jData); // Correct write length derived from GetStringUTFLength

    jsize totalWritten = 0;
    while (totalWritten < len) {
        int written = write(masterFd, cData + totalWritten, len - totalWritten);
        if (written <= 0) {
            break;
        }
        totalWritten += written;
    }

    env->ReleaseStringUTFChars(jData, cData);
    return totalWritten;
}

extern "C"
JNIEXPORT jbyteArray JNICALL
Java_com_cde_app_PtyBridge_readPty(JNIEnv *env, jobject thiz, jint masterFd) {
    char buf[1024];
    int bytesRead = read(masterFd, buf, sizeof(buf));
    if (bytesRead <= 0) {
        return NULL;
    }

    jbyteArray array = env->NewByteArray(bytesRead);
    if (!array) {
        return NULL;
    }
    env->SetByteArrayRegion(array, 0, bytesRead, (jbyte*)buf);
    return array;
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_cde_app_PtyBridge_closePty(JNIEnv *env, jobject thiz, jint masterFd) {
    int res = close(masterFd);
    if (childPid > 0) {
        int status;
        waitpid(childPid, &status, WNOHANG); // Reap the child with waitpid to prevent zombies
        childPid = -1;
    }
    return res;
}
