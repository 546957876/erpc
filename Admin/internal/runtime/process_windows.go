//go:build windows

package runtime

import (
	"os/exec"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func processCreationTime(pid int) (time.Time, bool) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return time.Time{}, false
	}
	defer windows.CloseHandle(handle)
	var exitCode uint32
	if windows.GetExitCodeProcess(handle, &exitCode) != nil || exitCode != 259 {
		return time.Time{}, false
	}
	var creation, exit, kernel, user windows.Filetime
	if windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user) != nil {
		return time.Time{}, false
	}
	return time.Unix(0, creation.Nanoseconds()), true
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
	return windows.GenerateConsoleCtrlEvent(syscall.CTRL_BREAK_EVENT, uint32(pid))
}

func killProcess(pid int) error {
	handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return windows.TerminateProcess(handle, 1)
}
