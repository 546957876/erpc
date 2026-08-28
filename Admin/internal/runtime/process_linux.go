//go:build linux

package runtime

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func processCreationTime(pid int) (time.Time, bool) {
	stat, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return time.Time{}, false
	}
	closeParen := strings.LastIndexByte(string(stat), ')')
	if closeParen < 0 {
		return time.Time{}, false
	}
	fields := strings.Fields(string(stat)[closeParen+1:])
	if len(fields) < 20 {
		return time.Time{}, false
	}
	startTicks, err := strconv.ParseInt(fields[19], 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	btime, err := bootTime()
	if err != nil {
		return time.Time{}, false
	}
	// Linux USER_HZ is 100 on the supported amd64 deployment target.
	return time.Unix(btime+startTicks/100, (startTicks%100)*10_000_000), true
}

func bootTime() (int64, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "btime" {
			return strconv.ParseInt(fields[1], 10, 64)
		}
	}
	return 0, fmt.Errorf("boot time is missing from /proc/stat")
}

func isOwnedProcess(pid int, expected time.Time) bool {
	actual, ok := processCreationTime(pid)
	if !ok {
		return false
	}
	difference := actual.Sub(expected)
	if difference < 0 {
		difference = -difference
	}
	return difference <= time.Second
}

func interruptProcess(pid int) error {
	if err := syscall.Kill(-pid, syscall.SIGINT); err != nil {
		return syscall.Kill(pid, syscall.SIGINT)
	}
	return nil
}

func killProcess(pid int) error {
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
		return syscall.Kill(pid, syscall.SIGKILL)
	}
	return nil
}
