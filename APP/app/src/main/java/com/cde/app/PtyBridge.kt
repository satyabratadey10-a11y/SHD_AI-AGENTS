package com.cde.app

object PtyBridge {
    init {
        System.loadLibrary("pty_bridge")
    }

    /**
     * Spawns a native shell process connected over a pseudo-terminal PTY.
     * Returns the Master File Descriptor (fd).
     */
    external fun spawnPty(shellPath: String): Int

    /**
     * Writes standard commands/inputs to the PTY master descriptor.
     */
    external fun writePty(masterFd: Int, data: String): Int

    /**
     * Reads output bytes from the PTY master descriptor.
     */
    external fun readPty(masterFd: Int): ByteArray?

    /**
     * Closes the active pseudo-terminal descriptor and reaps the child process safely.
     */
    external fun closePty(masterFd: Int): Int
}
