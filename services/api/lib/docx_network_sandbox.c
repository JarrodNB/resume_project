/* Restrict the renderer and every descendant before executing LibreOffice.
 * Unix sockets support its local IPC; internet sockets and privilege gains fail. */
#include <seccomp.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <errno.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 2 || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) return 126;
  scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ALLOW);
  if (!filter) return 126;
  if (seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(socket), 1,
      SCMP_A0(SCMP_CMP_NE, AF_UNIX)) || seccomp_load(filter)) return 126;
  seccomp_release(filter);
  execvp(argv[1], &argv[1]);
  return 126;
}
