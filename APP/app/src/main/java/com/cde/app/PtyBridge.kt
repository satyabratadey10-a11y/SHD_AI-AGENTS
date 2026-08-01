package com.cde.app

object PtyBridge {
    init {
        System.loadLibrary("pty_bridge")
    }

    /**
     * Spawns a native shell process connected over a pseudo-terminal PTY.
     * Returns the Master File Descriptor (fd).
     */
    external fun spawnPty(
        shellPath: String,
        args: Array<String> = emptyArray(),
        env: Array<String> = emptyArray()
    ): Int

    /**
     * Writes standard commands/inputs to the PTY master descriptor.
     */
    external fun writePty(masterFd: Int, data: String): Int

    /**
     * Reads output blocks from the PTY master descriptor.
     */
    external fun readPty(masterFd: Int): String?
}
